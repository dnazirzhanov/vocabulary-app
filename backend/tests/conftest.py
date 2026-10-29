import os
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

# Tests always run against the dedicated test database, never the dev one.
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://localhost/vocab_test"
)

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_engine, get_sessionmaker
from app.core.ratelimit import reset_limits
from app.main import create_app
from app.services.content import (
    DeckContent,
    import_deck,
    import_glossary,
    parse_deck,
    parse_glossary,
)
from tests.support import Play, Ratings, Spellings, at, finish, spell_today

BACKEND = Path(__file__).resolve().parents[1]
CONTENT = BACKEND.parent / "content"
LEVELS = ("a1-a2", "b1-b2", "c1")


@pytest.fixture(scope="session")
def starter_content() -> DeckContent:
    """The first level (A1–A2): the deck most tests study."""
    return parse_deck(CONTENT / "a1-a2")


@pytest.fixture(scope="session")
def database(starter_content: DeckContent) -> None:
    """Fresh schema once per run. Downgrading first also proves every migration reverses."""
    config = Config(str(BACKEND / "alembic.ini"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    with get_sessionmaker()() as db:
        for level in LEVELS:
            import_deck(db, parse_deck(CONTENT / level))
        import_glossary(db, parse_glossary(CONTENT / "glossary.yaml"))


@pytest.fixture
def db(database: None) -> Iterator[Session]:
    # Learner data is wiped before each test; content stays loaded.
    with get_engine().begin() as connection:
        connection.execute(
            text(
                "TRUNCATE users, learning_sessions, review_attempts, user_word_progress,"
                " pace_dismissals, groups, group_members CASCADE"
            )
        )
    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    reset_limits()
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def play(client: TestClient) -> Play:
    """Runs a whole session at a moment (tests.support.finish), cards rated as in `ratings`
    (default «Хорошо»); after a study session, today's spelling too (as a learner keeps the
    day's plan), built right unless `spellings` says otherwise, unless `spell=False`."""

    def run(
        start: dict[str, str],
        moment: datetime,
        ratings: Ratings | None = None,
        time_zone: str = "UTC",
        spellings: Spellings | None = None,
        spell: bool = True,
    ) -> dict[str, Any]:
        # Each played lesson stands for minutes of real answering: a fresh rate-limit window.
        reset_limits()
        headers = at(moment, time_zone)
        session = client.post("/api/sessions", json=start, headers=headers).json()
        finish(client, session, headers, ratings)
        summary: dict[str, Any] = client.post(
            f"/api/sessions/{session['id']}/complete", headers=headers
        ).json()
        if spell and start.get("kind") == "study":
            spell_today(client, headers, spellings)
        return summary

    return run
