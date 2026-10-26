# vocabulary-app

A gamified English vocabulary app for Russian-speaking learners. MVP / private-pilot stage.

- **What and why:** [`docs/product-requirements.md`](docs/product-requirements.md) (scope from the [engineering brief](docs/coding-agent-plan.md))
- **How it is built:** [`docs/architecture.md`](docs/architecture.md) and [`docs/decisions/`](docs/decisions/)

| Directory | Contents |
|---|---|
| `web/` | React + TypeScript app (Vite) — see [`web/README.md`](web/README.md) |
| `backend/` | FastAPI service, SQLAlchemy models, Alembic migrations, pytest |
| `content/` | Vocabulary decks as reviewed YAML — see [ADR 0005](docs/decisions/0005-content-as-yaml.md) |
| `docs/` | Brief, requirements, architecture, decision records |

## Setup from a clean checkout (macOS)

Prerequisites: [Homebrew](https://brew.sh), Node.js ≥ 22.12 (CI uses 24), and Git.

```sh
# 1. Tools: uv manages Python (≥ 3.13) and backend dependencies
brew install uv postgresql@17
brew services start postgresql@17

# 2. Databases (your macOS user is the Postgres superuser with Homebrew)
createdb vocab_dev
createdb vocab_test

# 3. Configuration
cp .env.example .env          # defaults work with the databases above

# 4. Dependencies, schema and the starter deck
make setup
make db-migrate
make content-load

# 5. Run
make dev                      # API on :8000, web app on http://localhost:5173
```

Check it is working: http://localhost:8000/api/health/ready should return `{"status":"ok","database":"ok"}`, and http://localhost:5173 should show the starter deck with a «Начать урок» button. Interactive API docs (development only): http://localhost:8000/api/docs.

Development has no sign-in yet (Phase 4): every request acts as one local user. To try a second learner, send an `X-Dev-User: <name>` header — the end-to-end tests do this so each test starts fresh.

On Linux, install PostgreSQL 17 from your distribution, create a role for your user (`sudo -u postgres createuser -s $USER`), and continue from step 2.

## Everyday commands

| Command | What it does |
|---|---|
| `make dev` | Run the API and the web app together (`make api` / `make web` for one) |
| `make check` | ruff, ruff format, mypy (backend); ESLint, Prettier, tsc (web) |
| `make test` | pytest against `vocab_test` (unit, API, concurrency); web unit tests |
| `make test-e2e` | Playwright: full lessons in a real browser against the API |
| `make db-migrate` | Apply Alembic migrations to the database in `DATABASE_URL` |
| `make content-load` | Validate `content/starter-deck` and import it (safe to re-run) |
| `cd web && npm run screenshots` | Capture the UI at phone, tablet and desktop sizes (dev server must be running) |

CI runs the same checks on every pull request (`.github/workflows/ci.yml`).

## Configuration

All settings are environment variables, validated at startup; `.env.example` documents each one. Never commit `.env`. The service refuses to start with development auth when `ENVIRONMENT=production` — real authentication arrives in Phase 4 (see [ADR 0004](docs/decisions/0004-auth-seam.md)).
