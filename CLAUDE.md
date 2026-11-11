# Slovar: working rules

English vocabulary app for Russian-speaking learners (and teachers' groups):
- **Backend:** FastAPI + Postgres (Supabase).
- **Frontend:** React/Vite web app, also shipped as an Android app via Capacitor.
- **Data:** offline-first; the device keeps decks and lessons in IndexedDB and syncs through an
  outbox.

Decisions live in `docs/decisions/` (ADRs); deployment in `docs/deploy.md`; Android in
`docs/android.md`.

## How work is done
- **Understand first.** Read the code a change touches, propose a short plan for anything
  substantial, and verify behaviour with evidence (commands and their results), not assumptions.
- **Tests:**
  - meaningful tests for every change; never weaken a test to make it pass;
  - for a bug fix, show the new test fails with the old behaviour.
- **End a task** with **What changed / Why / Verification / Risks / Next steps.**
- **Git:**
  - one PR per milestone; **merge only when the owner says "merge"**;
  - verify CI on the exact commit before merging and before deploying;
  - keep branches.

## Checks before pushing
- `make check`: lint, format and types for both sides. **It does not run the backend tests.**
- `cd backend && uv run pytest`: the full backend suite.
- `cd web && npm test`: unit tests; `npx playwright test --project=app --project=offline --project=auth`: e2e.

## Rules the code depends on
- **Interface text** exists in all six app languages (`web/src/i18n/{ru,en,ky,kk,uz,tg}.ts`); the
  unit tests fail on a missing, untranslated or unused key.
- **Server-side people-facing text** lives in `backend/app/core/locale.py` (a test refuses
  Russian elsewhere).
- **New database tables** enable row-level security in their migration (`test_no_public_access`).
- **Migrations** stay backward-compatible with the running production version.
- **Offline:** don't change how the outbox, the study pack or the service worker behave without a
  test in the `offline` Playwright project.
- **Production:**
  - Fly app `slovar-kg` (Stockholm, next to Supabase `eu-north-1`); production Supabase is
    `xlhiwcabkwgojbfhurmp`, never the development project;
  - secrets never go in the repo or in chat.
