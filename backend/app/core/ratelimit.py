"""Small per-learner rate limits.

In-process and per instance: enough for one server during the pilot. Retries of the same answer are
already harmless (ADR 0003); the answer limit stops scripted floods from filling the attempts
table, and the join limit stops anyone from guessing invite codes (ADR 0011).
"""

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.core.auth import CurrentUser
from app.core.config import Settings, get_settings
from app.core.errors import ApiError

WINDOW_SECONDS = 60.0
JOINS_PER_MINUTE = 10
_recent: dict[tuple[str, UUID], deque[float]] = defaultdict(deque)
_lock = Lock()


def _check(bucket: str, user_id: UUID, limit: int, message: str) -> None:
    now = time.monotonic()
    with _lock:
        stamps = _recent[(bucket, user_id)]
        while stamps and now - stamps[0] > WINDOW_SECONDS:
            stamps.popleft()
        if len(stamps) >= limit:
            raise ApiError(429, "rate_limited", message)
        stamps.append(now)


def limit_attempts(user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]) -> None:
    _check(
        "attempts", user.id, settings.attempts_per_minute, "Too many answers at once; wait a moment"
    )


def limit_joins(user: CurrentUser) -> None:
    _check("joins", user.id, JOINS_PER_MINUTE, "Too many invite codes tried; wait a minute")


def reset_limits() -> None:
    """For tests."""
    with _lock:
        _recent.clear()
