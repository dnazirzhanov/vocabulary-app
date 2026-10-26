# 0002 — Backend stack

**Status:** Accepted

## Context
The brief specifies Python, FastAPI, Pydantic, a maintained ORM or query layer, explicit migrations, structured logging and automated tests.

## Decision
- **Python ≥ 3.13**, dependencies and lockfile managed with **uv**.
- **FastAPI** with **Pydantic v2** models for every request and response; **pydantic-settings** for validated configuration.
- **SQLAlchemy 2** (typed ORM, synchronous sessions) with **Alembic** migrations and the **psycopg 3** driver.
- **ruff** for lint and format, **mypy --strict** for types, **pytest** against a real PostgreSQL test database.
- Logging through the standard library with a JSON formatter — no extra logging dependency.

Synchronous SQLAlchemy is chosen over async: the workload is small request/response CRUD, sync code is simpler to test and reason about, and FastAPI runs sync endpoints in a thread pool.

## Consequences
- One well-known, maintained toolchain; no custom data layer.
- Tests need PostgreSQL locally (Homebrew) and in CI (service container); SQLite is not used as a stand-in because constraints, arrays and partial indexes differ.
- Moving to async later is possible but not planned.
