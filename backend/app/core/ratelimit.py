"""A small per-learner rate limit for answer submissions.

In-process and per instance: enough for one server during the pilot. Retries of the same answer are
already harmless (ADR 0003); this stops scripted floods from filling the attempts table.
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
_recent: dict[UUID, deque[float]] = defaultdict(deque)
_lock = Lock()


def limit_attempts(user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]) -> None:
    now = time.monotonic()
    with _lock:
        stamps = _recent[user.id]
        while stamps and now - stamps[0] > WINDOW_SECONDS:
            stamps.popleft()
        if len(stamps) >= settings.attempts_per_minute:
            raise ApiError(429, "rate_limited", "Too many answers at once; wait a moment")
        stamps.append(now)


def reset_limits() -> None:
    """For tests."""
    with _lock:
        _recent.clear()
