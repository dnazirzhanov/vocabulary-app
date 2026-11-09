#!/usr/bin/env bash
# The database URL as the backup scripts need it (docs/backups.md), from the value as people paste
# it into a secret: surrounding spaces, line breaks or quotes are dropped; postgres:// and the
# app's postgresql+psycopg:// become postgresql://. Anything that still isn't a postgresql:// URI
# is refused, saying what is wrong without repeating it (it holds a password).
# A remote database gets sslmode=require unless the URL names a mode, so the data only travels
# encrypted; a local one (CI, a laptop) needs none.
# Usage: url="$(scripts/db-url.sh "$RAW")" (prints the URL; exits 1 with a message on stderr).
set -euo pipefail

url="$1"
# Spaces, tabs and line breaks around it.
url="${url#"${url%%[![:space:]]*}"}"
url="${url%"${url##*[![:space:]]}"}"
# One pair of quotes around it, as a shell or a .env file would have them.
if [[ ${#url} -ge 2 && ( ( "$url" == \"*\" ) || ( "$url" == \'*\' ) ) ]]; then
  url="${url:1:${#url}-2}"
fi
case "$url" in
  postgresql+psycopg://*) url="postgresql://${url#postgresql+psycopg://}" ;;
  postgres://*) url="postgresql://${url#postgres://}" ;;
esac

if [[ "$url" != postgresql://* ]]; then
  if [[ "$url" =~ ^([A-Za-z][A-Za-z0-9+.-]*):// ]]; then
    found="it starts with ${BASH_REMATCH[1]}://"
  else
    found="it has no scheme (postgresql://) at the start"
  fi
  echo "The database URL must be a URI such as postgresql://user:password@host:5432/postgres; $found." >&2
  echo "Supabase: Connect → Session pooler → URI (docs/backups.md)." >&2
  exit 1
fi
if [[ "$url" =~ [[:space:]] ]]; then
  echo "The database URL has a space or line break inside it; paste it again as one line." >&2
  exit 1
fi

# The host: after the credentials (the last @ before the path), before any port, path or query.
rest="${url#postgresql://}"
authority="${rest%%[/?]*}"
host="${authority##*@}"
if [[ "$host" == \[* ]]; then
  host="${host%%]*}]"  # an IPv6 address in brackets
else
  host="${host%%:*}"
fi
case "$host" in
  "" | localhost | 127.0.0.1 | "[::1]") local_host=1 ;;
  *) local_host=0 ;;
esac

query=""
[[ "$url" == *\?* ]] && query="${url#*\?}"
if [[ $local_host -eq 0 && "&$query" != *"&sslmode="* ]]; then
  if [[ "$url" == *\? ]]; then
    url="${url}sslmode=require"
  elif [[ -n "$query" ]]; then
    url="${url}&sslmode=require"
  else
    url="${url}?sslmode=require"
  fi
fi
printf '%s\n' "$url"
