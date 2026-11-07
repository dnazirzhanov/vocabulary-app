import time
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@dataclass
class QueryCount:
    """The SQL a request ran: how many statements, and their time in the database."""

    queries: int = 0
    seconds: float = 0.0


# Set per request by `logging.log_requests`; route handlers run in a thread with a copy of the
# context, which still points at the same counter.
query_count: ContextVar[QueryCount | None] = ContextVar("query_count", default=None)


def _started(conn: Any, *_: Any) -> None:
    conn.info.setdefault("query_started", []).append(time.perf_counter())


def _finished(conn: Any, *_: Any) -> None:
    started = conn.info["query_started"].pop()
    counter = query_count.get()
    if counter is not None:
        counter.queries += 1
        counter.seconds += time.perf_counter() - started


@lru_cache
def get_engine() -> Engine:
    engine = create_engine(
        get_settings().database_url,
        pool_pre_ping=True,
        # Timestamps come back in the session time zone; UTC keeps API output identical
        # wherever the database server runs.
        connect_args={"options": "-c timezone=UTC"},
    )
    event.listen(engine, "before_cursor_execute", _started)
    event.listen(engine, "after_cursor_execute", _finished)
    return engine


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Request-scoped session. Services commit explicitly; anything uncommitted rolls back."""
    with get_sessionmaker()() as session:
        yield session
