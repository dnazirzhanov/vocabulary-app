"""The weekly look back: one small change to the plan, with the evidence for it, which the learner
accepts or not. One at a time, so the effect of each can be seen; the plan gets easier before it
gets dropped, and grows only when it is kept with room to spare."""

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median
from typing import Literal

from app.services.coach.goal import Status

Kind = Literal["easier_minutes", "fewer_days", "move_time", "more_minutes", "behind"]

MIN_MINUTES = 10
MAX_MINUTES = 60
MIN_DAYS = 2
STEP_MINUTES = 5
# A start this far from the promised time, on most days, means the time is wrong.
MOVE_AFTER = 60


@dataclass(frozen=True)
class Week:
    """How last week went against the commitment."""

    promised: int
    kept: int
    # Local start minutes of sessions on studied days.
    starts: Sequence[int]
    # Minutes studied on each studied day.
    minutes_studied: Sequence[int]
    commit_start: int | None
    commit_minutes: int
    commit_days: int
    goal: Status = "open"


@dataclass(frozen=True)
class Proposal:
    kind: Kind
    # The new values, for those that change something.
    minutes: int | None = None
    days: int | None = None
    start: int | None = None


def _round15(minute: float) -> int:
    return int(round(minute / 15) * 15)


def review(week: Week) -> Proposal | None:
    if week.promised >= 2 and week.kept / week.promised < 0.5:
        if week.commit_minutes > MIN_MINUTES:
            return Proposal(
                "easier_minutes", minutes=max(MIN_MINUTES, week.commit_minutes - STEP_MINUTES)
            )
        if week.commit_days > MIN_DAYS:
            return Proposal("fewer_days", days=week.commit_days - 1)
    if week.commit_start is not None and len(week.starts) >= 3:
        usual = median(week.starts)
        if abs(usual - week.commit_start) >= MOVE_AFTER:
            return Proposal("move_time", start=_round15(usual))
    if (
        week.promised >= 2
        and week.kept == week.promised
        and week.minutes_studied
        and median(week.minutes_studied) >= week.commit_minutes * 1.2
        and week.commit_minutes < MAX_MINUTES
    ):
        return Proposal("more_minutes", minutes=week.commit_minutes + STEP_MINUTES)
    if week.goal in ("tight", "not_possible"):
        return Proposal("behind")
    return None
