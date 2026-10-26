"""Spaced repetition: a Leitner-style schedule (ADR 0006).

A word climbs one stage each time it is recalled in a review and drops back to stage 1 when it is
not. Each stage has a fixed interval. The intervals are hypotheses for the pilot to test, not
constants from research. All arithmetic is in UTC: an interval is an exact number of 24-hour days,
so daylight-saving changes in the learner's time zone never shift a schedule; time zones matter
only when deciding which local calendar day a moment falls on.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

INTERVALS: dict[int, timedelta] = {
    1: timedelta(days=1),
    2: timedelta(days=3),
    3: timedelta(days=7),
    4: timedelta(days=16),
    5: timedelta(days=35),
}
TOP_STAGE = max(INTERVALS)
# "Currently well learned" (docs/product-requirements.md): three delayed recalls in a row, the
# latest after an interval of at least 7 days.
WELL_LEARNED_STAGE = 4


@dataclass(frozen=True)
class Schedule:
    stage: int
    due_at: datetime


def _utc(moment: datetime) -> datetime:
    """Python adds timedeltas to aware datetimes in wall-clock time, so a day added across a DST
    change would be 23 or 25 hours. Converting to UTC first keeps every interval exact."""
    _require_aware(moment)
    return moment.astimezone(UTC)


def _require_aware(moment: datetime) -> None:
    if moment.tzinfo is None:
        raise ValueError("scheduling needs timezone-aware datetimes")


def first_schedule(introduced_at: datetime) -> Schedule:
    """A newly met word is first reviewed the next day."""
    return Schedule(stage=1, due_at=_utc(introduced_at) + INTERVALS[1])


def after_review(stage: int, recalled: bool, reviewed_at: datetime) -> Schedule:
    if stage not in INTERVALS:
        raise ValueError(f"unknown stage {stage}")
    next_stage = min(stage + 1, TOP_STAGE) if recalled else 1
    return Schedule(stage=next_stage, due_at=_utc(reviewed_at) + INTERVALS[next_stage])


def is_due(due_at: datetime, now: datetime) -> bool:
    """Due from the scheduled moment on (inclusive)."""
    _require_aware(due_at)
    _require_aware(now)
    return due_at <= now


def is_well_learned(stage: int) -> bool:
    return stage >= WELL_LEARNED_STAGE


def local_date(moment: datetime, time_zone: ZoneInfo) -> date:
    """The learner's calendar day for a moment — the only place time zones enter."""
    _require_aware(moment)
    return moment.astimezone(time_zone).date()
