# Deploying the demo (steps for the owner)

Nothing here has been run for you: it creates accounts and publishes the app. Do it when ready.
For a first class, follow `pilot.md`: these steps in order, plus what the class needs.

## 1. Supabase (Frankfurt, free) and email (ADR 0043)
1. Create a project in **Frankfurt (eu-central-1)**; note the database password.
2. Authentication → JWT Signing Keys: **create an asymmetric (ECC P-256) key and rotate to it**.
   Leave the JWT expiry at its default (an hour); never set it above a day.
3. **A dedicated Gmail account** for the app's mail, not your own: turn on 2-Step Verification, then
   make an app password (Google Account → Security → App passwords).
4. Authentication → SMTP settings → custom SMTP: host `smtp.gmail.com`, port `587`, your Gmail address
   and app password; sender name «Словарь». Without this Supabase only mails its own project team.
5. Authentication → Sign In / Providers → Email: **«Confirm email» on**, minimum password length 8.
6. Authentication → Email Templates: the app asks for a **code**, so use `{{ .Token }}` and no link.
   - «Confirm signup», subject «Код для входа в Словарь»: `<p>Ваш код: <b>{{ .Token }}</b></p>`
   - «Reset password», subject «Код для нового пароля»: `<p>Ваш код: <b>{{ .Token }}</b></p><p>Если это были не вы, просто удалите письмо.</p>`
7. Authentication → Rate Limits: **a school shares one IP**, and the defaults stop a class. Raise
   sign-ups and sign-ins, token verifications and token refreshes per IP, and emails per hour (custom
   SMTP starts at 30). Check the numbers against a real class before relying on them; Gmail's own
   limit is 500 a day.
8. Collect: project URL, publishable key, **secret key**, the session-pooler connection string.
9. Your issuer is `https://<project>.supabase.co/auth/v1`.

To try it on your computer before deploying: put `AUTH_ISSUER`, `SUPABASE_SECRET_KEY`,
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`, stop `make dev`, and run
`make dev-supabase`.

## 2. Host the container (Koyeb Frankfurt, or Render)
Build from the repo `Dockerfile` with build args `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
Runtime variables (secrets in the host's secret store, never in git):
`DATABASE_URL=postgresql+psycopg://…`, `AUTH_ISSUER=https://<project>.supabase.co/auth/v1`,
`SUPABASE_SECRET_KEY=…` (the app refuses to start without it; it can manage every login, so it never
goes anywhere else).
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
     schedule: [{ cron: "5 * * * *" }]   # every hour; each learner gets one, 18:00–22:00 their time
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
