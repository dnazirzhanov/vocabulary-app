import os
from collections.abc import Iterator
from pathlib import Path

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
from app.main import create_app
from app.services.content import DeckContent, import_deck, parse_deck

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
            text("TRUNCATE users, learning_sessions, review_attempts, user_word_progress CASCADE")
        )
    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client
