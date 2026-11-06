# Pilot with one class: checklist (for the owner)

A first run with real students: one teacher, one class, two or three weeks. Everything below is
done by you; nothing here has been published for you. Technical setup is in `deploy.md`; this
page puts it in order and adds what a class needs.

**Checked before this was written (Oct 30 2026):** with no Docker on the development machine, the
image's steps were reproduced by hand.
- A production web build was served by the API in production mode (`ENVIRONMENT=production`,
  `AUTH_MODE=jwt`), against a fresh database after `alembic upgrade head` and `load-content`.
- The health check, the sign-in page, the app manifest, the icons, the service worker and the
  photo reader's files were all served with the right types.
- The API refused anonymous calls, and the reminders endpoint answered only with its secret.

## 1. Before anything goes public (about 1 hour)
- [ ] **Merge PRs #31, #32 and #33**, in that order (photos, deadline status, reminders).
- [ ] **Decide who the pilot is with:** a teacher you know, one class, 10–30 students.
- [ ] **Consent.** Students may be minors. Agree with the school what is stored:
  - an e-mail to sign in;
  - a nickname inside the group (no real names, no chat, ADR 0011);
  - progress, and optional reminder subscriptions (no e-mail used for them).
  
  Ask whether parents need to be told. «Удалить аккаунт» deletes a student's data and sign-in
  e-mail at any time, after asking for the password.
- [ ] **Decide the support channel:** where students and the teacher report problems (e.g. a
  Telegram chat with you). Tell the teacher.

## 2. Accounts and deployment (about 2 hours; `deploy.md` §1–2)
- [ ] **Supabase project** (Frankfurt), an asymmetric JWT key, and email through a dedicated Gmail
  account: «Confirm email» on, code templates, raised rate limits (`deploy.md` §1).
- [ ] **Host:**
  - Koyeb or Render, building the `Dockerfile` with `VITE_SUPABASE_URL` and
    `VITE_SUPABASE_PUBLISHABLE_KEY`;
  - secrets `DATABASE_URL`, `AUTH_ISSUER` and `SUPABASE_SECRET_KEY`;
  - health check `/api/health/ready`.
- [ ] **Drafting decks from text and photos** needs `DEEPSEEK_API_KEY` in the host's secrets.
  - Top up DeepSeek credit first. Each draft is one model call (see DeepSeek's price page); the
    daily limit is 20 drafts per teacher.
  - Photos are read in the browser and cost nothing.
- [ ] **Open the URL on a phone:** sign up with a real address and type the code from the email, see
  «Мои колоды», open the course, finish one lesson. Then sign out, reset the password, and delete
  this test account; check that it is gone from Supabase.

- [ ] **Nightly cleanup** runs from GitHub Actions (`deploy.md` §3): run it once by hand and check
  the answer.

## 3. Reminders (about 20 minutes; `deploy.md` §3a)
- [ ] **Keys:**
  - run `uv run python -m app.cli vapid-keys` once;
  - add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:<you>` and a random
    `REMINDERS_TOKEN` to the host's secrets;
  - **never change the keys during the pilot.**
- [ ] **Hourly schedule:**
  - add the GitHub Actions workflow from `deploy.md` and the secrets `APP_URL` and
    `REMINDERS_TOKEN`;
  - run it once by hand («Run workflow»). It should answer `{"sent": 0}`.
- [ ] **Try it on one Android phone and one iPhone** (iPhone: Share → «На экран „Домой“» first):
  - turn on «Уведомления»;
  - give yourself a deck with a deadline tomorrow and leave today's words unlearned;
  - wait for the evening run.

## 4. Backups (about 30 minutes; `deploy.md` §4)
- [ ] **Nightly encrypted `pg_dump`,** stored outside Supabase.
- [ ] **Restore it once** into a scratch database before inviting anyone.

## 5. The teacher's setup (with the teacher, about 30 minutes)
- [ ] **The teacher signs up** and creates the group in «Друзья», then shows the class the
  invite's QR code.
- [ ] **The teacher makes the first deck** in «Мои колоды» from a photo of the textbook page
  («Текст» → «Добавить фото»), checks the words, and gives it to the group with «Выучить к» set
  to the next lesson.
- [ ] **Show the teacher where to check progress:** «Друзья» → the group: who kept today's promise,
  and each student's words in the deck.

## 6. First lesson with the class (10 minutes of class time)
- [ ] **Students join and turn on reminders:**
  - sign up on their phones and join by the QR code (nickname only);
  - iPhones: add the app to the home screen first;
  - turn on «Уведомления».
- [ ] **Everyone finishes one lesson in class,** so problems show up while you are there.

## 7. During the pilot: what to watch, weekly
- [ ] **Readiness:** the group page before each class. How many «успевают»? Ask the teacher
  whether it matched who knew the words.
- [ ] **Steadiness:** the friends board (words learned this week) and days studied. Do students
  come back on days without a class?
- [ ] **Reminders:** do they arrive, at a sensible time? Too many?
- [ ] **Problems** reported in the support channel. Host logs record failed drafts and reminders,
  never students' texts.

## 8. After the pilot
- [ ] **A short talk** with the teacher and 3–5 students: what helped, what was confusing, what
  they skipped.
- [ ] **Decide what to keep:** keep the data and continue, or delete the group and the accounts
  (each «Удалить аккаунт» removes the database rows and the Supabase user).

## Rollback
Redeploy the previous image. If a migration is at fault: `alembic downgrade -1`. Reminders stop
when the scheduled workflow is disabled.
