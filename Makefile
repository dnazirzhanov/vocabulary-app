# Common tasks. `make help` lists them.
.PHONY: help setup db-migrate content-load api web dev dev-supabase check test test-e2e

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-11s %s\n", $$1, $$2}'

setup: ## Install backend and web dependencies
	cd backend && uv sync
	cd web && npm ci

db-migrate: ## Apply migrations to DATABASE_URL (from .env)
	cd backend && uv run alembic upgrade head

content-load: ## Validate the three level decks and import them into DATABASE_URL
	cd backend && uv run python -m app.cli load-content ../content/a1-a2 ../content/b1-b2 ../content/c1

seed-classmates: ## Development only: a demo group of made-up classmates for the local dev user
	cd backend && uv run python -m app.cli seed-classmates

api: ## Run the API on http://localhost:8000
	cd backend && uv run uvicorn app.main:app --reload --port 8000

web: ## Run the web app on http://localhost:5173 (proxies /api to the API)
	cd web && npm run dev

dev: ## Run the API and the web app together
	$(MAKE) -j2 api web

dev-supabase: ## Run both with real sign-in (stop `make dev` first; keys in .env, see docs/deploy.md)
	set -a && . ./.env && set +a && AUTH_MODE=jwt VITE_AUTH_MODE=supabase $(MAKE) -j2 api web

check: ## Lint, format check and type check everything
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy .
	cd web && npm run lint && npm run format:check && npm run typecheck

test: ## Run backend and web unit/integration tests
	cd backend && uv run pytest
	cd web && npm test

test-e2e: ## Run browser end-to-end tests (reuses `make dev` if running)
	cd web && npm run test:e2e
