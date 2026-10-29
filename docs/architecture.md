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
| Progress, points, goal and streaks | `services/progress.py` (pure rules + queries) | 3 |
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
| `user_word_progress` | `user_id`, `word_id`, `introduced_at`, `last_seen_at`, `correct_count`, `incorrect_count`, `stage`, `due_at`, `last_reviewed_at`, `review_count`, `lapses` | `PK(user_id, word_id)`; `stage BETWEEN 1 AND 5`; index `(user_id, due_at)` |
| `learning_sessions` | `id uuid`, `user_id`, `deck_id`, `kind` (`new` \| `practice` \| `review`), `plan jsonb`, `started_at`, `completed_at null` | partial `UNIQUE(user_id) WHERE completed_at IS NULL` — at most one open session per user |
| `review_attempts` | `id bigint`, `session_id`, `user_id`, `word_id`, `exercise_id`, `exercise_type` (`card`; older quiz types kept for history), `rating 1–4` (cards), `was_review`, `answered_at`, `due_after`, `points` | `UNIQUE(session_id, exercise_id)`; a rating exactly for cards |

Scheduling state was added to `user_word_progress` by its own migration in Phase 3 (existing words got their first review the day after they were met).

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
| `GET /api/decks` | decks with the current user's counts (`word_count`, `introduced_count`, `due_count`, `next_due_at`) and the sourced `course_goal` |
| `GET /api/sessions/active` | `{ "session": … }` or `{ "session": null }` |
| `POST /api/sessions` | `{kind: "study", deck_id}` (due cards from every deck, then new words sized by the daily pace) or `{kind: "hard", deck_id}` (practice on the hardest words; schedule unchanged); returns the open session if one exists; `409 nothing_to_study` / `409 nothing_to_practice` |
| `GET /api/sessions/{id}` | session with exercises and results so far |
| `POST /api/sessions/{id}/attempts` | `{exercise_id, response: {kind: "rating", rating: 1–4}}` → `{rating, next_due_at, appended, appended_index}` (a card due again within minutes is inserted later in the session) |
| `POST /api/sessions/{id}/complete` | summary: words with mistake counts and `next_review_at`, answer totals, session `points`, `today_points`, `daily_goal`, `deck_id` |
| `GET /api/progress` | the whole course: word stages (met, reviewing, well learned, due), today's plan, a year of days (plan done or not, ADR 0015), this week's promise, weeks kept in a row, delayed-recall rate over 30 days |
| `GET /api/decks/{id}/words` | every word of the deck in order (nothing hidden) with the learner's status (`not_started`, `new`, `learning`, `well_learned`) and `next_review_at` |
| `GET /api/groups`, `POST /api/groups` | my groups; create one `{name, nickname}` (ADR 0011) |
| `GET /api/groups/join/{code}`, `POST /api/groups/join/{code}` | invite preview (name, member count) and joining with `{nickname}`; rate-limited |
| `GET /api/groups/{id}/board` | the week's board: places by the share of each member's promise kept (plan days of the days promised, ADR 0015), plan-day dots, weeks kept in a row, the shared goal in planned words; members only; no points |
| `DELETE /api/groups/{id}/members/me`, `DELETE /api/groups/{id}/members/{member_id}` | leave; the owner removes a member |
| `GET /api/glossary` | every word form used in example sentences → `{ru, lemma, note}`, for tap-a-word (ADR 0013) |
| `GET /api/me`, `PATCH /api/me` | pace settings (`daily_target_words` 1–100, `study_days_per_week`, `ramp_enabled`) and `onboarded`; saving a target finishes the first-run screens (ADR 0010) |
| `GET /api/me/pace?deck_id=` | today's plan: target, ramp, new words today, size of the next lesson or bonus, review-debt block, measured seconds per exercise, an optional suggestion |
| `POST /api/me/pace/dismiss` | `{kind: "lower" \| "raise"}`: that suggestion stays quiet for 7 days |

Requests carry `X-Time-Zone` (the browser's IANA zone) so "today" and streaks follow the learner's calendar (ADR 0008).

Every query is filtered by the authenticated user. A session that exists but belongs to someone else returns **404**, not 403, so identifiers cannot be probed. Request bodies are validated by Pydantic with explicit length limits (e.g. typed answers ≤ 100 characters).

## Home: the stepping-stone path (M8)
The home screen shows the deck as stones across water (`web/src/lib/path.ts`, `web/src/path/`).
Every 5 words in deck order are a stone and every 2 stones a level. A stone is *done* when all its
words are met and *firm* when all are "помню хорошо" (stage ≥ 4). The state is derived in the
browser from `GET /api/decks/{id}/words`, so the path and the word list cannot disagree. No server
state is added. When the learner comes back from a lesson that finished a stone, the frog hops
forward. The last stone seen is kept in memory for the visit only, so a reload shows the position
without a hop. With `prefers-reduced-motion` the hop is skipped, and every move is announced in
a live region.

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

## Spaced repetition (ADR 0006)

A Leitner-style scheduler in a pure module, `services/scheduling.py`:

| Stage | Next review after | Reached by |
|---|---|---|
| 1 | 1 day | being introduced, or missing a review |
| 2 | 3 days | one review recalled |
| 3 | 7 days | two in a row |
| 4 | 16 days | three in a row — "currently well learned" |
| 5 | 35 days (cap) | four or more in a row |

- **Review sessions** take up to 8 due words, most overdue first. Each word gets `recall_meaning`
  (options hidden until the learner asks for them) and later `type_word`; it counts as recalled
  only if both are right. The attempt that completes a word reschedules it in the same transaction
  and records `stage_after` / `due_after`.
- New-word and practice sessions never change a schedule. Leaving a review part-way keeps every
  word whose exercises were finished; the rest stay due.
- Intervals are exact 24-hour days added in UTC; time zones only decide a moment's local calendar
  day. Database sessions run in UTC so timestamps leave the API in one form.
- Time comes from one dependency (`core/clock.py`). In development, `X-Dev-Now` moves it so review
  flows can be tested; responses carry `X-Server-Time`, and the web app counts "tomorrow" from
  server time rather than the device clock (ADR 0007).

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
