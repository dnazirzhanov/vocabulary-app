#!/usr/bin/env bash
# Production secrets on Fly (docs/deploy.md). Asks for each without showing it and hands them to
# `fly secrets import` through a pipe: never on screen, in the shell's history or in a file. The
# database URL is checked first: production's Supabase project, a postgresql URI (cleaned of
# spaces and quotes, turned into the app's postgresql+psycopg:// form).
# Usage: scripts/fly-secrets.sh   (after `fly auth login`; from the repository root)
set -euo pipefail
cd "$(dirname "$0")/.."
app="$(sed -n 's/^app = "\(.*\)"/\1/p' fly.toml)"
project="$(sed -n 's|.*VITE_SUPABASE_URL = "https://\([a-z0-9]*\)\.supabase\.co".*|\1|p' fly.toml)"
[[ -n "$app" && -n "$project" ]] || { echo "fly.toml names no app or Supabase project" >&2; exit 1; }

ask() {  # ask <prompt> → the value, read without echo
  local value
  read -rsp "$1: " value </dev/tty
  echo >&2
  printf '%s' "$value"
}
trim() {  # spaces, line breaks and one pair of quotes around a pasted value
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  if [[ ${#v} -ge 2 && ( "$v" == \"*\" || "$v" == \'*\' ) ]]; then v="${v:1:${#v}-2}"; fi
  printf '%s' "$v"
}

echo "Secrets for the Fly app '$app' (Supabase project $project). Nothing you type is shown." >&2
db="$(trim "$(ask "Database: Supabase → Connect → Session pooler → URI, with the password")")"
case "$db" in
  postgresql+psycopg://*) ;;
  postgresql://*) db="postgresql+psycopg://${db#postgresql://}" ;;
  postgres://*) db="postgresql+psycopg://${db#postgres://}" ;;
  *) echo "That isn't a postgresql:// URI (Supabase → Connect → Session pooler → URI)." >&2; exit 1 ;;
esac
if [[ "$db" != *"postgres.$project:"* && "$db" != *"@db.$project.supabase.co"* ]]; then
  echo "That URI is for another Supabase project: production is $project." >&2
  exit 1
fi
if [[ "$db" == *"[YOUR-PASSWORD]"* ]]; then
  echo "Put the database password in place of [YOUR-PASSWORD]." >&2
  exit 1
fi
secret="$(trim "$(ask "Supabase secret key (Project Settings → API Keys → secret)")")"
[[ "$secret" == sb_secret_* || "$secret" == eyJ* ]] || { echo "That doesn't look like a Supabase secret key." >&2; exit 1; }
deepseek="$(trim "$(ask "DeepSeek API key, for teachers' AI drafts and speaking feedback (Enter to skip)")")"
openai="$(trim "$(ask "OpenAI API key, for Whisper transcription (Enter to skip — speaking won't grade)")")"
azure="$(trim "$(ask "Azure Speech key, for pronunciation assessment (Enter to skip)")")"
supabase_url="https://$(sed -n 's|.*VITE_SUPABASE_URL = "https://\([^"]*\)".*|\1|p' fly.toml)"
token="$(openssl rand -hex 32)"

{
  printf 'DATABASE_URL=%s\n' "$db"
  printf 'SUPABASE_SECRET_KEY=%s\n' "$secret"
  printf 'SUPABASE_URL=%s\n' "$supabase_url"
  printf 'REMINDERS_TOKEN=%s\n' "$token"
  [[ -n "$deepseek" ]] && printf 'DEEPSEEK_API_KEY=%s\n' "$deepseek"
  [[ -n "$openai" ]] && printf 'OPENAI_API_KEY=%s\n' "$openai"
  [[ -n "$azure" ]] && printf 'AZURE_SPEECH_KEY=%s\n' "$azure"
} | fly secrets import --app "$app" --stage

set_names="DATABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_URL, REMINDERS_TOKEN"
[[ -n "$deepseek" ]] && set_names="$set_names, DEEPSEEK_API_KEY"
[[ -n "$openai" ]] && set_names="$set_names, OPENAI_API_KEY"
[[ -n "$azure" ]] && set_names="$set_names, AZURE_SPEECH_KEY"
echo >&2
echo "Set: $set_names." >&2
echo "REMINDERS_TOKEN is needed once more, as a GitHub secret of the same name (docs/deploy.md)." >&2
read -rp "Show REMINDERS_TOKEN now, on this screen only, to copy into GitHub? [y/N] " show </dev/tty
[[ "$show" == [yY] ]] && echo "$token"
exit 0
