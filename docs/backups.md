# Backups (ADR 0059)

Free Supabase keeps no backups. A GitHub Actions workflow (`.github/workflows/backup.yml`) makes
one every night at 01:30 UTC, encrypts it, keeps it 30 days, and proves it restores.

## What a backup holds
- `app-<time>.dump.enc`: every table of the app (schema `public`): accounts, decks, cards,
  progress, answers, groups, tests. Restorable into any Postgres 17.
- `auth-<time>.dump.enc`: Supabase's `auth.users` and `auth.identities` (e-mail, password hash,
  confirmation), only where the database is Supabase. Without it, learners would have to sign up
  again and would lose the link to their progress.
- `SHA256SUMS-<time>`: checksums of both files.

Both files are encrypted with AES-256 (`openssl enc`, key from the passphrase with 600,000 rounds
of PBKDF2) before they leave the runner. The repository is private; even so, nothing readable is
ever uploaded.

## Turning it on (once, after the database exists)
In GitHub: Settings → Secrets and variables → Actions → New repository secret:
1. `BACKUP_DATABASE_URL`: the database's **direct** connection string from Supabase (Project
   Settings → Database → Connection string → URI, port 5432), `postgresql://…`. A read-only user
   is better if you make one; `pg_dump` only reads.
2. `BACKUP_PASSPHRASE`: a long random passphrase (for example 6+ random words). **Store it in a
   password manager as well.** Without it no backup can ever be opened, and GitHub will not show
   it again.

Then Actions → Backup → Run workflow, and check the run is green. Until both secrets exist, the
workflow only warns «No backup made».

Every run, after uploading, restores the app's dump into a throwaway Postgres inside the runner
and checks the tables, the migration revision and the words (`scripts/restore-check.sh`). A red
run means that night's backup could not be restored: look before the next one.

CI runs the same two scripts on every pull request against the test database.

## Restoring
Never into the production database while it is in use. Into a new, empty database:
1. Actions → the run you want → Artifacts → download `backup-<id>`, unzip.
2. Check: `shasum -a 256 -c SHA256SUMS-*`.
3. `BACKUP_PASSPHRASE='…' scripts/restore-check.sh app-<time>.dump.enc "<new database URL>"`.
   It refuses a database that already has tables.
4. Point the app's `DATABASE_URL` at it and start the app; migrations run on start and bring it
   up to the current version.
5. Logins (only if the Supabase project itself was lost): decrypt `auth-<time>.dump.enc` the same
   way (`openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE`) and
   restore it into the new project's `auth` schema with `pg_restore --data-only`. Do this with
   Supabase's support documentation at hand; it is the rarest and most delicate step.

## Limits
- At most a day of work can be lost (the time since the last night's backup).
- 30 days of history. Artifacts count toward the repository's Actions storage; a dump of 1,000
  students is a few tens of MB (the load test's database was 249 MB uncompressed).
- If GitHub itself were lost, so would the backups be. When the app has real users and money,
  Supabase Pro's own daily backups are a second, independent copy.
- A lost passphrase means every backup is lost too.
