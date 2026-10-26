# Common tasks. `make help` lists them.
.PHONY: help setup db-migrate api web dev check test

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-11s %s\n", $$1, $$2}'

setup: ## Install backend and web dependencies
	cd backend && uv sync
	cd web && npm ci

db-migrate: ## Apply migrations to DATABASE_URL (from .env)
	cd backend && uv run alembic upgrade head

api: ## Run the API on http://localhost:8000
	cd backend && uv run uvicorn app.main:app --reload --port 8000

web: ## Run the web app on http://localhost:5173 (proxies /api to the API)
	cd web && npm run dev

dev: ## Run the API and the web app together
	$(MAKE) -j2 api web

check: ## Lint, format check and type check everything
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy .
	cd web && npm run lint && npm run format:check && npm run typecheck

test: ## Run backend and web tests
	cd backend && uv run pytest
	cd web && npm test
