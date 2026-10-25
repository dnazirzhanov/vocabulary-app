from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        get_settings().database_url,
        pool_pre_ping=True,
        # Timestamps come back in the session time zone; UTC keeps API output identical
        # wherever the database server runs.
        connect_args={"options": "-c timezone=UTC"},
    )


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Request-scoped session. Services commit explicitly; anything uncommitted rolls back."""
    with get_sessionmaker()() as session:
        yield session
