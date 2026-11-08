#!/usr/bin/env bash
# Proves a backup restores (docs/backups.md): decrypts the app's dump into a scratch database
# that must be empty, then checks the tables and rows are there. It refuses a database that
# already has tables, so it can never write over a real one.
# With the manifest written beside the dump, it also checks that every table came back with its
# rows (at least 99%: the database may change while it is dumped), every foreign key, and the
# same migration.
# Usage: BACKUP_PASSPHRASE=… scripts/restore-check.sh <app-….dump.enc> "<scratch database url>" [manifest-….txt.enc]
set -euo pipefail

dump="$1"
url="${2/postgresql+psycopg:/postgresql:}"
manifest="${3:-}"
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

[ -z "$manifest" ] && exit 0
problems=0
while IFS='|' read -r kind name expected; do
  case "$kind" in
    rows)
      got="$(psql "$url" -Atc "SELECT count(*) FROM public.\"$name\"" 2>/dev/null || echo missing)"
      if [ "$got" = missing ]; then
        echo "missing table: $name" >&2; problems=$((problems + 1))
      elif [ $((got * 100)) -lt $((expected * 99)) ]; then
        echo "$name: $got rows restored, $expected before the dump" >&2; problems=$((problems + 1))
      fi ;;
    foreign_keys)
      got="$(psql "$url" -Atc "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace")"
      [ "$got" = "$expected" ] || { echo "foreign keys: $got restored, $expected before" >&2; problems=$((problems + 1)); } ;;
    revision)
      [ "$revision" = "$expected" ] || { echo "revision: $revision restored, $expected before" >&2; problems=$((problems + 1)); } ;;
  esac
done < <(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$manifest")
checked="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$manifest" | grep -c '^rows|')"
[ "$problems" -eq 0 ] || { echo "the backup does not hold what the database held" >&2; exit 1; }
echo "matches the manifest: $checked tables, foreign keys and revision"
