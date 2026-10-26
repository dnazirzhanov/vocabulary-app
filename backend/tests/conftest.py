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
from app.services.content import DeckContent, import_deck, parse_deck
from tests.support import Play, Ratings, at, rate

BACKEND = Path(__file__).resolve().parents[1]
STARTER_DECK = BACKEND.parent / "content" / "starter-deck"


@pytest.fixture(scope="session")
def starter_content() -> DeckContent:
    return parse_deck(STARTER_DECK)


@pytest.fixture(scope="session")
def database(starter_content: DeckContent) -> None:
    """Fresh schema once per run. Downgrading first also proves every migration reverses."""
    config = Config(str(BACKEND / "alembic.ini"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    with get_sessionmaker()() as db:
        import_deck(db, starter_content)


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
    """Runs a whole session at a moment. Each card's first showing gets the rating given for its
    headword in `ratings` (default «Хорошо»); cards shown again in the session get «Хорошо»."""

    def run(
        start: dict[str, str],
        moment: datetime,
        ratings: Ratings | None = None,
        time_zone: str = "UTC",
    ) -> dict[str, Any]:
        headers = at(moment, time_zone)
        session = client.post("/api/sessions", json=start, headers=headers).json()
        cards = list(session["exercises"])
        seen: set[str] = set()
        index = 0
        while index < len(cards):
            card = cards[index]
            headword = card["word"]["headword"]
            rating = (ratings or {}).get(headword, 3) if headword not in seen else 3
            seen.add(headword)
            result = client.post(
                f"/api/sessions/{session['id']}/attempts",
                json={"exercise_id": card["id"], "response": rate(rating)},
                headers=headers,
            ).json()
            if result.get("appended"):
                # The server inserted another showing a few cards later; mirror its position.
                cards = client.get(f"/api/sessions/{session['id']}", headers=headers).json()[
                    "exercises"
                ]
            index += 1
        summary: dict[str, Any] = client.post(
            f"/api/sessions/{session['id']}/complete", headers=headers
        ).json()
        return summary

    return run
