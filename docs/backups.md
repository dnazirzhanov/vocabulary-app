# Backups (ADR 0059)

Free Supabase keeps no backups. A GitHub Actions workflow (`.github/workflows/backup.yml`) makes
one every night at 01:30 UTC, encrypts it, keeps it 30 days, and proves it restores.

## What a backup holds
- `app-<time>.dump.enc`: every table of the app (schema `public`): accounts, decks, cards,
  progress, answers, groups, tests. Restorable into any Postgres 17.
- `auth-<time>.dump.enc`: Supabase's `auth.users` and `auth.identities` (e-mail, password hash,
  confirmation), only where the database is Supabase. Without it, learners would have to sign up
  again and would lose the link to their progress.
- `manifest-<time>.txt.enc`: what the database held just before the dump: every table's rows,
  the number of foreign keys, the migration revision. The restore check compares against it.
- `SHA256SUMS-<time>`: checksums of the files.

**How the data is protected:**
- **From the database to the runner:** the data travels over TLS. `scripts/backup.sh` adds
  `sslmode=require` to any database that isn't local.
- **On the runner:** `pg_dump` writes into `openssl` through a pipe, so the dump is encrypted
  before it touches the disk. It is encrypted with AES-256 (`openssl enc`), with the key made from
  the passphrase by 600,000 rounds of PBKDF2.
- **Not inside the database's own environment:** Supabase doesn't encrypt a dump for us. What
  leaves the runner, and what anyone could download, is only ciphertext. The repository is
  private as well.

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

Every run, after uploading, restores the app's dump into a throwaway Postgres inside the runner and
compares it with the manifest (`scripts/restore-check.sh`):
- every table is there, with at least 99% of the rows it had just before the dump (the database
  may change while it is dumped);
- every foreign key is there;
- the migration revision is the same.

A red run means that night's backup doesn't bring the data back: look before the next one.

CI runs the same two scripts on every pull request against the test database.

## Restoring
Never into the production database while it is in use. Into a new, empty database:
1. Actions → the run you want → Artifacts → download `backup-<id>`, unzip.
2. Check: `shasum -a 256 -c SHA256SUMS-*`.
3. `BACKUP_PASSPHRASE='…' scripts/restore-check.sh app-<time>.dump.enc "<new database URL>" manifest-<time>.txt.enc`.
   It refuses a database that already has tables, and says if anything is missing.
4. Point the app's `DATABASE_URL` at it and start the app; migrations run on start and bring it
   up to the current version.
5. Logins (only if the Supabase project itself was lost): decrypt `auth-<time>.dump.enc` the same
   way (`openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE`) and
   restore it into the new project's `auth` schema with `pg_restore --data-only`. Do this with
   Supabase's support documentation at hand; it is the rarest and most delicate step.

## Once a week: a copy outside GitHub (owner's choice)
The nightly copies live only in GitHub. Once a week, download the newest one to your own computer
(and, if you like, copy the folder to your Google Drive), so a copy exists even if GitHub or the
repository is lost:

```
gh run download --repo dnazirzhanov/vocabulary-app \
  $(gh run list --repo dnazirzhanov/vocabulary-app --workflow Backup --status success --limit 1 --json databaseId --jq '.[0].databaseId') \
  --dir ~/slovar-backups/$(date +%F)
cd ~/slovar-backups/$(date +%F)/backup-* && shasum -a 256 -c SHA256SUMS-*
```

Keep the last four or five weeks.

**Restoring from this copy needs no GitHub:** only `openssl`, the Postgres 17 tools, and
`scripts/restore-check.sh` (keep a copy of it with the backups). Use step 3 above. The files are
encrypted, so a lost laptop or a shared Drive folder exposes nothing without the passphrase.

## Limits
- At most a day of work can be lost (the time since the last night's backup).
- 30 days of history. Artifacts count toward the repository's Actions storage; a dump of 1,000
  students is a few tens of MB (the load test's database was 249 MB uncompressed).
- If GitHub itself were lost, only the weekly copies on your computer would remain: up to a week
  of work could be lost. When the app has real users and money, Supabase Pro's own daily backups
  are a further, independent copy.
- A lost passphrase means every backup is lost too.
