"""Study days (ADR 0027): the one rule every count of days uses.

A day counts when the learner finished at least one session that day: a lesson, spelling or hard
words. Answering a card or two and leaving doesn't count; how much was done doesn't matter.
Which days were promised, and the records built on them, are in `promise` (ADR 0039). There is no
daily «план» any more: the new words a day is a pace for the decks, never something a day is
judged by.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from app.models import LearningSession, ReviewAttempt, StudyDayTotal, User

# How far back days are read: a year, enough for any weekly streak shown.
HISTORY_DAYS = 366


@dataclass(frozen=True)
class StudyDay:
    day: date
    # Every card answered that day, of any kind: the heatmap's shade.
    answers: int
    # A session of any kind finished that day.
    finished: bool

    @property
    def studied(self) -> bool:
        return self.finished


def week_of(day: date) -> list[date]:
    """Monday to Sunday of the week holding `day`."""
    monday = day - timedelta(days=day.weekday())
    return [monday + timedelta(days=n) for n in range(7)]


def zone_of(user: User) -> ZoneInfo:
    return ZoneInfo(user.time_zone or "UTC")


def days_by_user(
    db: Session, users: Sequence[User], since: datetime, time_zone: ZoneInfo | None = None
) -> dict[UUID, dict[date, StudyDay]]:
    """Every day with answers since `since`, per learner. Days are local to `time_zone`, or, when
    it is None (a group board), to each learner's own stored zone."""
    if not users:
        return {}
    zone = literal(time_zone.key) if time_zone else func.coalesce(User.time_zone, "UTC")
    local_day = func.date(func.timezone(zone, ReviewAttempt.answered_at))
    rows = db.execute(
        select(
            ReviewAttempt.user_id,
            local_day,
            func.count(),
            func.bool_or(LearningSession.completed_at.is_not(None)),
        )
        .join(LearningSession, LearningSession.id == ReviewAttempt.session_id)
        .join(User, User.id == ReviewAttempt.user_id)
        .where(
            ReviewAttempt.user_id.in_([user.id for user in users]),
            ReviewAttempt.answered_at >= since,
        )
        .group_by(ReviewAttempt.user_id, local_day)
    )
    result: dict[UUID, dict[date, StudyDay]] = {user.id: {} for user in users}
    for user_id, day, answers, finished in rows:
        result[user_id][day] = StudyDay(day=day, answers=int(answers), finished=bool(finished))
    # Days whose answers are gone (ADR 0044), added to any that are left of the same day.
    totals = db.execute(
        select(
            StudyDayTotal.user_id, StudyDayTotal.day, StudyDayTotal.answers, StudyDayTotal.finished
        ).where(
            StudyDayTotal.user_id.in_([user.id for user in users]),
            StudyDayTotal.day >= since.date(),
        )
    )
    for user_id, day, answers, finished in totals:
        known = result[user_id].get(day)
        result[user_id][day] = StudyDay(
            day=day,
            answers=answers + (known.answers if known else 0),
            finished=finished or (known.finished if known else False),
        )
    return result
