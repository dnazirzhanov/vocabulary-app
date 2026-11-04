# Deploying the demo (steps for the owner)

Nothing here has been run for you: it creates accounts and publishes the app. Do it when ready.
For a first class, follow `pilot.md`: these steps in order, plus what the class needs.

## 1. Supabase (Frankfurt, free)

1. Create a project in **Frankfurt (eu-central-1)**; note the database password.
2. Authentication → Sign In / Providers → Email: **turn off "Confirm email"** (demo; no email domain).
3. Authentication → JWT Signing Keys: **create an asymmetric (ECC P-256) key and rotate to it**.
4. Collect: project URL, publishable key, the session-pooler connection string.
5. Your issuer is `https://<project>.supabase.co/auth/v1`.

## 2. Host the container (Koyeb Frankfurt, or Render)

Build from the repo `Dockerfile` with build args `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
Runtime variables (secrets in the host's secret store, never in git):
`DATABASE_URL=postgresql+psycopg://…`, `AUTH_ISSUER=https://<project>.supabase.co/auth/v1`.
Health check: `/api/health/ready`. The free host sleeps when idle; the first visit can take a minute.

## 3. Deadline reminders (optional; ADR 0031)

1. Make a key pair once: `cd backend && uv run python -m app.cli vapid-keys`. Add both lines to the
   host's secrets, plus `VAPID_SUBJECT=mailto:<your address>` and `REMINDERS_TOKEN=<a long random
string>` (e.g. `openssl rand -hex 32`). Changing the keys later cuts off every phone that
   turned reminders on (they must turn them on again).
2. Something must call the app once an hour; the free host sleeps, so an outside scheduler does it.
   A free GitHub Actions schedule works: add the repository secrets `APP_URL` and `REMINDERS_TOKEN`,
   and the file `.github/workflows/reminders.yml`:
   ```yaml
   name: reminders
   on:
     schedule: [{ cron: "5 * * * *" }] # every hour; each learner gets one, 18:00–22:00 their time
     workflow_dispatch:
   jobs:
     send:
       runs-on: ubuntu-latest
       steps:
         - run: >
             curl --fail --silent --show-error --max-time 120 -X POST
             -H "X-Reminders-Token: ${{ secrets.REMINDERS_TOKEN }}"
             "${{ secrets.APP_URL }}/api/internal/reminders"
   ```
3. iPhones only receive them when the app is added to the home screen (Safari → Share → «На экран
   „Домой“»); the app says so where reminders are turned on.

## 4. Backups (free Supabase has none)

Nightly: `pg_dump "$DATABASE_URL" | gzip | gpg -c > backup.sql.gz.gpg`, stored outside Supabase.
**Restore it into a scratch database once before inviting anyone.**

## 5. Roll back

Redeploy the previous image. If a migration is at fault, `alembic downgrade -1` against the database.
