#!/usr/bin/env bash
# Proves a backup restores (docs/backups.md): decrypts the app's dump into a scratch database
# that must be empty, then checks the tables and rows are there. It refuses a database that
# already has tables, so it can never write over a real one.
# Usage: BACKUP_PASSPHRASE=… scripts/restore-check.sh <app-….dump.enc> "<scratch database url>"
set -euo pipefail

dump="$1"
url="${2/postgresql+psycopg:/postgresql:}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

existing="$(psql "$url" -Atc "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$existing" != "0" ]; then
  echo "refusing: the target database already has $existing tables" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE \
  -in "$dump" -out "$work/app.dump"
# Every new database has the schema `public` already; everything else in the dump is restored.
pg_restore --list "$work/app.dump" | grep -v ' SCHEMA - public ' > "$work/contents"
pg_restore --no-owner --no-privileges --exit-on-error --use-list="$work/contents" \
  --dbname="$url" "$work/app.dump"

tables="$(psql "$url" -Atc "select count(*) from pg_tables where schemaname = 'public'")"
revision="$(psql "$url" -Atc "select version_num from alembic_version")"
users="$(psql "$url" -Atc "select count(*) from users")"
words="$(psql "$url" -Atc "select count(*) from words")"
echo "restored: $tables tables, revision $revision, $users users, $words words"
[ "$tables" -ge 26 ] && [ -n "$revision" ] && [ "$words" -gt 0 ]
