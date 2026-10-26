# Deploying the demo (steps for the owner)

Nothing here has been run for you: it creates accounts and publishes the app. Do it when ready.

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

## 3. Backups (free Supabase has none)
Nightly: `pg_dump "$DATABASE_URL" | gzip | gpg -c > backup.sql.gz.gpg`, stored outside Supabase.
**Restore it into a scratch database once before inviting anyone.**

## 4. Roll back
Redeploy the previous image. If a migration is at fault, `alembic downgrade -1` against the database.
