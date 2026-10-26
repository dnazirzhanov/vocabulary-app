"""Plain helpers shared by tests (fixtures live in conftest.py)."""

from collections.abc import Callable
from datetime import datetime
from typing import Any

Ratings = dict[str, int]  # headword → rating for its first showing in a session
Play = Callable[..., dict[str, Any]]


def at(moment: datetime, time_zone: str = "UTC") -> dict[str, str]:
    """Headers for a request made at `moment` (development clock) from a learner in `time_zone`."""
    return {"X-Dev-Now": moment.isoformat(), "X-Time-Zone": time_zone}


def rate(rating: int = 3) -> dict[str, object]:
    """A flashcard rating: 1 Снова, 2 Трудно, 3 Хорошо, 4 Легко."""
    return {"kind": "rating", "rating": rating}
