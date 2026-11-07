# 0059 — Nightly encrypted backups in GitHub, each one restored to prove it

**Status:** Accepted (owner's choice of storage, 7 November 2026).

## Context
Free Supabase has no backups. Losing the database would lose every learner's progress and every deck. A backup that has never been restored is not known to work.

## Decision
- A scheduled GitHub Actions workflow dumps the app's schema and Supabase's login tables with `pg_dump`, encrypts both with a passphrase (AES-256, `openssl enc` with PBKDF2), and keeps them 30 days as the run's artifact: outside the database provider, at no cost, no new account.
- The same run restores the app's dump into a throwaway Postgres in the runner and checks it. The restore script refuses any database that already has tables, so it can't overwrite a real one.
- CI runs both scripts on every pull request.
- Secrets live only in GitHub (`BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`); the owner keeps the passphrase in a password manager too.

## Consequences
- Up to a day of work can be lost; history is 30 days.
- The backups share GitHub's fate. Supabase Pro's own backups would add an independent copy later.
- Restoring logins into a new Supabase project is documented but delicate (`docs/backups.md`).
