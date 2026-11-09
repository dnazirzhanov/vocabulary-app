#!/usr/bin/env bash
# Nightly backup (docs/backups.md): the app's data (schema `public`) and the logins it maps to
# (`auth.users`, `auth.identities`), each dumped and encrypted with the passphrase, never written
# in the clear. Usage: BACKUP_PASSPHRASE=… scripts/backup.sh "<database url>" <output dir>
set -euo pipefail

# As pasted into the secret (spaces, quotes, postgres://, the app's own URL), cleaned and checked;
# a remote database is only spoken to over TLS (scripts/db-url.sh).
url="$("$(dirname "$0")/db-url.sh" "$1")"
out="$2"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
mkdir -p "$out"
stamp="$(date -u +%Y-%m-%dT%H%MZ)"

encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "$1"
}

# What the dump should hold, taken just before it: each table's rows, the foreign keys, the
# migration. The restore check compares against it, so a backup is proved to bring the data back,
# not only a database (scripts/restore-check.sh).
psql "$url" -At -F'|' -v ON_ERROR_STOP=1 <<'SQL' | encrypt "$out/manifest-$stamp.txt.enc"
SELECT 'rows', table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
SELECT 'foreign_keys', '', count(*)::text FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
SELECT 'revision', '', version_num FROM alembic_version;
SQL

# The app's tables: restorable into any Postgres (no owners or grants from the provider).
pg_dump --format=custom --no-owner --no-privileges --schema=public "$url" \
  | encrypt "$out/app-$stamp.dump.enc"

# Logins, for rebuilding the sign-in service; skipped where there is no `auth` schema (local).
if psql "$url" -Atc "select to_regclass('auth.users') is not null" | grep -q t; then
  pg_dump --format=custom --no-owner --no-privileges --data-only \
    --table=auth.users --table=auth.identities "$url" \
    | encrypt "$out/auth-$stamp.dump.enc"
fi

( cd "$out" && shasum -a 256 ./*.enc > "SHA256SUMS-$stamp" )
echo "backup written: $(ls "$out")"
