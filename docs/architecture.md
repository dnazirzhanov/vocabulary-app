# Architecture

A modular monolith: one React web app, one FastAPI service, one PostgreSQL database. Decisions with trade-offs are recorded in [`decisions/`](decisions/).

```text
 Browser (phone / desktop)
   web/  React + TypeScript (Vite)          static files
     │  fetch /api/*  (JSON)
     ▼
 backend/  FastAPI ── services (pure logic) ── SQLAlchemy ── PostgreSQL
     ▲
 content/  version-controlled YAML ──(validate + import command)──┘
```

## Repository layout

```text
web/                 React app (kept from the prototype; ADR 0001)
  src/lib/           API client and shared types
  src/home/          home / deck entry screen
  src/lesson/        session screen, exercise views, session reducer
  src/summary/       end-of-session summary
  src/illustrations/ original SVG illustrations
  src/styles/        design tokens
backend/
  app/core/          settings, database, logging, auth seam, errors
  app/models/        SQLAlchemy tables
  app/schemas/       Pydantic request/response contracts
  app/services/      business logic (content, learning, sessions)
  app/api/           thin HTTP handlers
  alembic/           migrations
  tests/
content/starter-deck/  deck.yaml, words.yaml
docs/                  brief, requirements, this file, ADRs
```

## Modules

| Module (brief §5) | Lives in | Phase |
|---|---|---|
| Auth and user profile | `core/auth.py`, `models/user.py` | seam in 1–2, provider in 4 |
| Vocabulary and decks | `services/content.py`, `models/content.py` | 2 |
| Learning sessions and answer evaluation | `services/learning.py` (pure), `services/sessions.py` (DB) | 2 |
| Review scheduling | `services/scheduling.py` (pure) | 3 |
| Progress and statistics | `services/progress.py` | 2–3 |
| Gamification | `services/points.py` | 3 |
| Analytics | derived from `review_attempts` / `learning_sessions` first | 3+ |
| Admin and content validation | `app/cli.py`, `services/content.py` | 2 |

Rule: HTTP handlers parse input, call one service function, and shape the response. Learning rules never live in handlers or React components.

## Data model

All timestamps are `timestamptz`, stored and compared in UTC.

| Table | Key columns | Constraints |
|---|---|---|
| `users` | `id uuid`, `auth_subject text`, `display_name text null`, `created_at` | `UNIQUE(auth_subject)` |
| `decks` | `id text` (stable slug), `title`, `description`, `learning_language`, `explanation_language`, `status`, `content_version int` | |
| `words` | `id text` (stable slug), `headword`, `pos`, `translation`, `also_accept text[]` (extra English spellings), `example`, `example_ru`, `illustration null` | |
| `deck_words` | `deck_id`, `word_id`, `position` | `PK(deck_id, word_id)`, `UNIQUE(deck_id, position)` |
| `user_word_progress` | `user_id`, `word_id`, `introduced_at`, `last_seen_at`, `correct_count`, `incorrect_count` | `PK(user_id, word_id)` — one record per user and word |
| `learning_sessions` | `id uuid`, `user_id`, `deck_id`, `kind` (`new` \| `practice`), `plan jsonb`, `started_at`, `completed_at null` | partial `UNIQUE(user_id) WHERE completed_at IS NULL` — at most one open session per user |
| `review_attempts` | `id bigint`, `session_id`, `user_id`, `word_id`, `exercise_id`, `exercise_type`, `correct bool null`, `answered_at` | `UNIQUE(session_id, exercise_id)`; `correct IS NULL` only for `introduce` |

Phase 3 adds scheduling state to `user_word_progress` (`stage`, `next_review_at`, `status`) in its own migration rather than carrying unused columns now.

**Deliberately not stored:** typed answer text, device information, IP addresses in the database.

## Learning session flow (Phase 2)

1. **Plan** (`services/learning.py`, pure and deterministic): take the next 5 words in deck order that the user has not been introduced to. Build the exercise list:
   - for each word: `introduce`, then `choose_meaning` (English word → pick the Russian meaning from 4 options);
   - then, for each word again: `type_word` (Russian meaning + English example with the word blanked → type the English word).
   Distractors come from the same deck, preferring the same part of speech, chosen by a seeded shuffle so a plan is reproducible in tests.
2. **Store** the plan (including answer keys) as JSON on the session row. Clients receive exercises **without answer keys**.
3. **Attempt**: the client submits one response per exercise, in plan order (skipping ahead returns `409 out_of_order`). The server evaluates it, writes the attempt and updates progress **in one transaction**. A second submission for the same exercise returns the stored result unchanged (idempotent; prevents double counting and answer fishing). When two devices race, the unique constraint fails at flush time and the loser returns the stored result — covered by `tests/test_concurrency.py`.
4. **Resume**: the open session (if any) is returned with the results so far; the client continues at the first unanswered exercise.
5. **Complete**: allowed once every exercise has a result; returns the summary. Completing again returns the same summary.
6. **Practice**: a `practice` session repeats `choose_meaning` + `type_word` for words answered wrongly in a completed session that the same user owns.

Typed-answer normalisation: trim, lowercase, collapse whitespace, unify apostrophes, strip surrounding punctuation; correct if equal to the headword or any `also_accept` form. No typo tolerance in v1 — feedback shows the correct spelling.

**What clients see before answering:** an introduction shows everything; a choose-meaning question shows the headword, part of speech and example but not the meaning or the picture (the picture would let learners match image to meaning without reading the word); a typing question shows the meaning and the example with the word blanked out.

## API contract (Phase 2)

JSON over HTTPS. Errors always have the shape `{"error": {"code": "...", "message": "..."}}`; unexpected errors return `internal_error` with no internal details.

| Method & path | Purpose |
|---|---|
| `GET /api/health/live` | process is up |
| `GET /api/health/ready` | database reachable |
| `GET /api/decks` | decks with the current user's counts (`word_count`, `introduced_count`) |
| `GET /api/sessions/active` | `{ "session": … }` or `{ "session": null }` |
| `POST /api/sessions` | `{deck_id, kind: "new"}` or `{kind: "practice", source_session_id}`; returns the open session if one exists; `409 deck_complete` when no new words remain |
| `GET /api/sessions/{id}` | session with exercises and results so far |
| `POST /api/sessions/{id}/attempts` | `{exercise_id, response}` → `{correct, answer}` |
| `POST /api/sessions/{id}/complete` | summary: words with mistake counts, answer totals, `deck_id` for "next words" |

Every query is filtered by the authenticated user. A session that exists but belongs to someone else returns **404**, not 403, so identifiers cannot be probed. Request bodies are validated by Pydantic with explicit length limits (e.g. typed answers ≤ 100 characters).

## Authentication and authorization

- Every endpoint depends on `get_current_user`. Handlers never accept a user id from the client.
- **Now (ADR 0004):** `AUTH_MODE=dev` resolves to a local development user (optionally selected with an `X-Dev-User` header, for multi-user testing). Settings validation refuses to start when `ENVIRONMENT=production`, and `dev` is currently the only mode — so the service cannot be deployed to production by accident before real auth exists.
- **Phase 4:** a managed provider issues JWTs; `get_current_user` verifies signature, issuer, audience and expiry against the provider's keys and maps the subject to `users.auth_subject`. Nothing else changes.
- No admin endpoints exist. Content is managed through the import command, run by a developer.

## Content pipeline (ADR 0005)

`content/starter-deck/` holds `deck.yaml` (metadata, word order, provenance, review status) and `words.yaml`. `make content-load` (`uv run python -m app.cli load-content ../content/starter-deck`; `validate-content` checks without a database):

1. parses YAML into Pydantic models;
2. validates: unique ids, slug format, required translation and examples, example contains the headword as a whole word, accepted answers non-empty, deck references only known words, illustration ids from the known set;
3. upserts words, the deck and deck order in one transaction. Re-running with unchanged content is a no-op.

Validation runs in CI, so a broken deck cannot be merged.

## Spaced repetition (Phase 3 outline)

A Leitner-style scheduler in a pure module. Stages with intervals of roughly 1, 3, 7, 16 and 35 days — **hypotheses to validate in the pilot**, not constants from research. A correct recall moves a word up one stage; an incorrect one moves it back to stage 1 and schedules it for the next day (and again within the current session). Intervals are added to UTC timestamps; the learner's time zone is used only for "today" (daily goal, due-today counts), which is where daylight-saving tests apply. Due reviews are offered before new words, with a cap so new material is not starved.

## Reliability

- One transaction per state-changing request; uniqueness constraints make retries safe.
- Concurrent requests from two devices on the same session: the unique constraint decides which attempt wins; the loser receives the stored result.
- The client distinguishes a wrong answer from a network or server error and offers a retry for the latter.
- Structured JSON logs (method, path, status, duration) — never request bodies.
- Health endpoints for the hosting platform's checks.

## Configuration and environments

Settings come from environment variables (`.env` locally, never committed; `.env.example` lists every key with placeholder values) and are validated at startup:

| Variable | Purpose |
|---|---|
| `ENVIRONMENT` | `development` \| `test` \| `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_MODE` | `dev` (Phase 4 adds `jwt`) |
| `ALLOWED_ORIGINS` | CORS origins for deployed web app; empty in development (Vite proxies `/api`) |

Local development: Homebrew PostgreSQL with `vocab_dev` and `vocab_test` databases.

## Testing and CI

- **Backend unit:** content validation, answer normalisation, session planning; later scheduling and points.
- **Backend integration:** API against a real PostgreSQL test database, migrated with Alembic (so migrations are tested too): full session flow, idempotent attempts, ownership (404), resume.
- **Web unit:** reducers and pure helpers with `node:test`.
- **End-to-end:** Playwright — complete a session, reload, progress persists; reload mid-session resumes.
- **CI (GitHub Actions)** on every pull request: ruff, mypy, content validation, migrations, pytest with a Postgres service container; ESLint, `tsc`, web tests and build; end-to-end tests.

## Deployment (to decide before Phase 4)

Recommendation, **not yet verified**: a managed PostgreSQL + auth provider in an EU region (Supabase is the leading candidate because it combines both and supports standard `pg_dump` export), the FastAPI container on a managed host, and the static web build on a CDN host. Before choosing: verify pricing, availability and payment from Kyrgyzstan, data export, backups and restore, and JWT compatibility. Nothing is deployed and no paid service is created without explicit approval.

Rollback intent: application deploys are immutable images that can be redeployed; every migration has a tested downgrade or a documented forward fix; backups are restored to a scratch database before launch to prove they work.
