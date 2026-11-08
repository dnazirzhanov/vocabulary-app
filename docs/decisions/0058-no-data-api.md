# 0058 — FastAPI is the only way to the data; Supabase's Data API reaches none of it

**Status:** Accepted (7 November 2026, from the architecture audit; a blocker before real students).

## Context
Supabase serves the `public` schema over REST to anyone holding the project's publishable key, and that key is built into the web app, as it must be for sign-in. Every table of the app lives in `public`, and none had row-level security. On a Supabase database, anyone could have listed users, names, progress and push endpoints, or changed them, without going through the API's checks.

## Decision
- **One way in:** the browser talks to FastAPI only; FastAPI talks to Postgres as the tables' owner. The app uses Supabase for sign-in and nothing else.
- **A migration shuts the Data API out**, twice over: row-level security on every table with no policies (nothing is visible or writable to the API's roles), and every privilege of `anon` and `authenticated` taken away, including on tables made later (default privileges). The owner is not restricted by RLS, so the app is unaffected; Supabase Auth lives in its own schema, untouched.
- **The project setting goes too:** `docs/deploy.md` step 1.10 turns the Data API off and gives a `curl` check to run after deploying.
- **A test keeps it so:** `tests/test_no_public_access.py` fails if any table lacks RLS, if either role holds any privilege or a default one, or if `anon` can read `users`. The test database is given Supabase's roles and its default grants first, so the check is made against what a real project does.

## Consequences
- Every new table needs `ENABLE ROW LEVEL SECURITY` in its migration, or CI fails.
- Supabase's REST, Realtime and client-side queries can't be used for app data unless a later decision adds policies for them deliberately.
- Tests create the two roles in the local Postgres cluster once (they are cluster-wide); they have no login.
