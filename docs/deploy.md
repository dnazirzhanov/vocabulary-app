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
   The same mail goes to everyone, whatever their language (ADR 0055), so it is only the code.
   - «Confirm signup», subject `Slovar: {{ .Token }}`: `<p style="font-size:28px"><b>{{ .Token }}</b></p>`
   - «Reset password», subject `Slovar: {{ .Token }}`: `<p style="font-size:28px"><b>{{ .Token }}</b></p>`
7. Authentication → Rate Limits: **a school shares one IP**, and the defaults stop a class. Raise
   sign-ups and sign-ins, token verifications and token refreshes per IP, and emails per hour (custom
   SMTP starts at 30). Check the numbers against a real class before relying on them; Gmail's own
   limit is 500 a day.
8. Collect: project URL, publishable key, **secret key**, the session-pooler connection string.
9. Your issuer is `https://<project>.supabase.co/auth/v1`.
10. **Close the Data API to the app's tables (ADR 0058).** Supabase serves the `public` schema over
    REST to anyone with the publishable key, which every browser has. The migrations already turn on
    row-level security with no policies and take every privilege from `anon` and `authenticated`;
    also close the door itself: Project Settings → Data API → turn it off (the app never uses it;
    sign-in is unaffected), or at least remove `public` from «Exposed schemas». After the first
    deploy, check from any computer, with the publishable key:
    `curl -s "https://<project>.supabase.co/rest/v1/users?select=id" -H "apikey: <publishable key>"`
    must not list any user (an error, or `[]`). Anything else: stop and fix before inviting anyone.

**If sign-up hangs for about 35 seconds and no email comes,** Supabase cannot reach the mail server:
it answers `504 upstream request timeout` and keeps no account. Check the SMTP host and port above;
Authentication logs in the dashboard give the exact reason. Never test with made-up addresses: bounces
count against the Gmail account.

To try it on your computer before deploying: put `AUTH_ISSUER`, `SUPABASE_SECRET_KEY`,
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`, stop `make dev`, and run
`make dev-supabase`.

## 2. Host the container (Koyeb Frankfurt, or Render)
Build from the repo `Dockerfile` with build args `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
Runtime variables (secrets in the host's secret store, never in git):
`DATABASE_URL=postgresql+psycopg://…`, `AUTH_ISSUER=https://<project>.supabase.co/auth/v1`,
`SUPABASE_SECRET_KEY=…` (the app refuses to start without it; it can manage every login, so it never
goes anywhere else), and `ALLOWED_ORIGINS=https://localhost` for the Android app, whose pages come from
inside the app (`docs/android.md`; ADR 0063). Without it every request from the app is refused.
Health check: `/api/health/ready`. The free host sleeps when idle; the first visit can take a minute.

## 3. Nightly cleanup (required; ADR 0044)
Without it the free database fills up within months. Make a secret once (`openssl rand -hex 32`) and put
it in the host's secrets as `REMINDERS_TOKEN`. Add the repository secrets `APP_URL` and
`REMINDERS_TOKEN`, and the file `.github/workflows/cleanup.yml`:
```yaml
name: cleanup
on:
  schedule: [{ cron: "30 22 * * *" }]   # 04:30 in Bishkek
  workflow_dispatch:
jobs:
  clean:
    runs-on: ubuntu-latest
    steps:
      - run: >
          curl --fail --silent --show-error --max-time 120 -X POST
          -H "X-Reminders-Token: ${{ secrets.REMINDERS_TOKEN }}"
          "${{ secrets.APP_URL }}/api/internal/cleanup"
```
The answer says `"finished": false` if it stopped early; the next night carries on.

## 3a. Notifications (optional; ADR 0031, 0042)
1. Make a key pair once: `cd backend && uv run python -m app.cli vapid-keys`. Add both lines to the
   host's secrets, plus `VAPID_SUBJECT=mailto:<your address>` and `REMINDERS_TOKEN=<a long random
   string>` (the same one as the cleanup). Changing the keys later cuts off every phone that
   turned reminders on (they must turn them on again).
2. Something must call the app once an hour; the free host sleeps, so an outside scheduler does it.
   A free GitHub Actions schedule works, with the same repository secrets as the cleanup, and the file `.github/workflows/reminders.yml`:
   ```yaml
   name: reminders
   on:
     schedule: [{ cron: "5 * * * *" }]   # every hour; each learner's own 08:00 and 17:00 (ADR 0042)
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
   **Every zone is served by the hourly run,** but at 0.1 CPU a run reaches an estimated 80–100 phones
   (`docs/decisions/0042-…`). If the answer says `"finished": false` often in a class's morning, add
   runs inside those hours: `*/15 2-3,11-13 * * *` is 08–10 and 17–20 in Bishkek. GitHub's free minutes
   on a private repo are shared with CI.
3. iPhones only receive them when the app is added to the home screen (Safari → Share → «На экран
   „Домой“»); the app says so where reminders are turned on.

## 3b. Before a class
Capacity was measured on a laptop with the CPU limited, not on a real host
(`docs/research/capacity-2026-11.md`). Run a class-sized trial first, and keep an eye on Supabase's
usage page for database size and egress: the free plan includes 500 MB and 5 GB a month.

## 4. Backups (free Supabase has none)
Add the two secrets in `docs/backups.md` («Turning it on»), run the Backup workflow once by hand
and check it is green, before inviting anyone.

## 5. Roll back
Redeploy the previous image. If a migration is at fault, `alembic downgrade -1` against the database.
