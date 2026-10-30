"""Study days (ADR 0027): the one rule every count of days uses.

A day counts when the learner finished at least one session that day: a lesson, spelling or hard
words. Answering a card or two and leaving doesn't count; how much was done doesn't matter. The
week counts these days against the days a week the learner promised; weeks in a row with the
promise kept are the streak. There is no daily «план» any more: the new words a day is a pace
for the decks, never something a day is judged by.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from app.models import LearningSession, ReviewAttempt, User
from app.services.scheduling import local_date

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
    return result


def promises_by_user(
    db: Session, users: Sequence[User], since: datetime, time_zone: ZoneInfo | None = None
) -> dict[UUID, dict[date, int]]:
    """The days a week each learner promised, per week (keyed by its Monday): the promise on the
    week's first lesson, so a change made mid-week applies from the next week."""
    rows = db.execute(
        select(LearningSession.user_id, LearningSession.started_at, LearningSession.promised_days)
        .where(
            LearningSession.user_id.in_([user.id for user in users]),
            LearningSession.promised_days.is_not(None),
            LearningSession.started_at >= since,
        )
        .order_by(LearningSession.started_at)
    )
    by_id = {user.id: user for user in users}
    result: dict[UUID, dict[date, int]] = {user.id: {} for user in users}
    for user_id, started_at, promised in rows:
        if promised is None:  # excluded by the query; narrows the type
            continue
        monday = week_of(local_date(started_at, time_zone or zone_of(by_id[user_id])))[0]
        result[user_id].setdefault(monday, promised)
    return result


@dataclass(frozen=True)
class Week:
    days: list[StudyDay | None]  # Monday to Sunday; None: no answers that day
    promised: int

    @property
    def studied(self) -> list[bool]:
        return [day is not None and day.studied for day in self.days]

    @property
    def studied_days(self) -> int:
        return sum(self.studied)

    @property
    def kept_promise(self) -> bool:
        return self.studied_days >= self.promised


def week_days(days: Mapping[date, StudyDay], week: Iterable[date], promised: int) -> Week:
    return Week(days=[days.get(day) for day in week], promised=promised)


def week_streak(
    days: Mapping[date, StudyDay], promises: Mapping[date, int], default: int, today: date
) -> int:
    """Weeks in a row with the promise kept, ending with this week once it is kept — or with last
    week, so a week still under way never shows a streak as broken."""
    monday = week_of(today)[0]

    def kept(week_start: date) -> bool:
        promised = promises.get(week_start, default)
        return week_days(days, week_of(week_start), promised).kept_promise

    count = 1 if kept(monday) else 0
    week_start = monday - timedelta(days=7)
    while kept(week_start):
        count += 1
        week_start -= timedelta(days=7)
    return count
