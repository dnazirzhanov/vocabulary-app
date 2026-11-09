#!/usr/bin/env bash
# Tests scripts/db-url.sh with made-up credentials (no real database or secret): the forms a
# pasted secret takes, query parameters such as ?sslmode=require, local and remote hosts, and
# refusals that never repeat the password. Run: scripts/test-db-url.sh
set -uo pipefail
here="$(dirname "$0")"
failed=0
pass='s3cr3t-Pa55'  # made up: the refusal messages must never contain it

expect() {  # expect <description> <input> <wanted output>
  local got
  got="$("$here/db-url.sh" "$2" 2>/dev/null)"
  if [[ "$got" == "$3" ]]; then echo "ok   $1"; else echo "FAIL $1"; failed=1; fi
}
refuse() {  # refuse <description> <input> <part of the message>
  local err
  if err="$("$here/db-url.sh" "$2" 2>&1 >/dev/null)"; then
    echo "FAIL $1 (accepted)"; failed=1; return
  fi
  if [[ "$err" == *"$pass"* ]]; then echo "FAIL $1 (the message shows the password)"; failed=1; return
  fi
  if [[ "$err" == *"$3"* ]]; then echo "ok   $1"; else echo "FAIL $1 (said: $err)"; failed=1; fi
}

remote="postgresql://postgres.abcd:$pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
expect "a remote URI gets sslmode=require" "$remote" "$remote?sslmode=require"
expect "one already asking for TLS is kept as it is" "$remote?sslmode=require" "$remote?sslmode=require"
expect "another sslmode is respected" "$remote?sslmode=verify-full" "$remote?sslmode=verify-full"
expect "other parameters keep theirs, and TLS is added" "$remote?connect_timeout=10" "$remote?connect_timeout=10&sslmode=require"
expect "sslmode after another parameter is seen" "$remote?connect_timeout=10&sslmode=require" "$remote?connect_timeout=10&sslmode=require"
expect "a parameter merely ending in sslmode doesn't count" "$remote?xsslmode=1" "$remote?xsslmode=1&sslmode=require"
expect "spaces and a line break around it (a pasted secret)" "  $remote
" "$remote?sslmode=require"
expect "a Windows line ending" "$remote"$'\r' "$remote?sslmode=require"
expect "double quotes around it" "\"$remote?sslmode=require\"" "$remote?sslmode=require"
expect "single quotes around it" "'$remote'" "$remote?sslmode=require"
expect "postgres:// is the same scheme" "postgres://postgres.abcd:$pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" "$remote?sslmode=require"
expect "the app's own URL works" "postgresql+psycopg://postgres.abcd:$pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" "$remote?sslmode=require"
expect "a password with an encoded @ and :" "postgresql://u:p%40ss%3Aword@db.example.com/postgres" "postgresql://u:p%40ss%3Aword@db.example.com/postgres?sslmode=require"
expect "a local database needs no TLS" "postgresql://vocab:vocab@localhost:5432/vocab_test" "postgresql://vocab:vocab@localhost:5432/vocab_test"
expect "nor one at 127.0.0.1" "postgresql://vocab:vocab@127.0.0.1/vocab_test" "postgresql://vocab:vocab@127.0.0.1/vocab_test"
expect "nor a socket" "postgresql:///vocab_test" "postgresql:///vocab_test"
expect "a host merely starting with localhost is remote" "postgresql://u:p@localhost.example.com/db" "postgresql://u:p@localhost.example.com/db?sslmode=require"

refuse "no scheme" "postgres.abcd:$pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" "no scheme"
refuse "another scheme (a JDBC string)" "jdbc:postgresql://aws-0-eu-central-1.pooler.supabase.com:5432/postgres?user=u&password=$pass" "no scheme"
refuse "an http URL" "https://abcd.supabase.co" "starts with https://"
refuse "a space inside" "postgresql://u:$pass@host /postgres" "space"
refuse "the psql command copied with it" "psql 'postgresql://u:$pass@host/postgres'" "no scheme"
refuse "empty" "" "no scheme"

exit $failed
