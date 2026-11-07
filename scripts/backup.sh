#!/usr/bin/env bash
# Nightly backup (docs/backups.md): the app's data (schema `public`) and the logins it maps to
# (`auth.users`, `auth.identities`), each dumped and encrypted with the passphrase, never written
# in the clear. Usage: BACKUP_PASSPHRASE=… scripts/backup.sh "<database url>" <output dir>
set -euo pipefail

url="${1/postgresql+psycopg:/postgresql:}"  # the app's URL works too
out="$2"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
mkdir -p "$out"
stamp="$(date -u +%Y-%m-%dT%H%MZ)"

encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "$1"
}

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
