"""Plan days (ADR 0015, 0022): consistency measured against each learner's own promise.

A learner promises a pace: so many new words a day, so many days a week. A day counts when that
day's plan was done: a study lesson finished with every due review done (no reviews left across
the decks when it ended), and the day's target of new words met — the target is already lowered
to what was left to learn, so with no new words left, cleared reviews keep the day. Spelling is
practice, not part of the day (ADR 0022). The week counts the days done against the days
promised; extra days, extra words and practice never raise a place. Extra learning is reported
separately, for the learner's profile.

The day's target is the one recorded on that day's study sessions (the smallest, if it changed);
sessions from before it was recorded fall back to the learner's current settings.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from fractions import Fraction
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, literal, select
from sqlalchemy.orm import Session

from app.models import LearningSession, ReviewAttempt, User
from app.services.pace import effective_target, ramp_week, target_of
from app.services.progress import INTRODUCTION
from app.services.scheduling import local_date

# Practice («Трудные слова») is extra by definition; spelling has its own part of the plan; every
# other kind of session is study.
PRACTICE = "hard"
SPELLING = "spelling"
# How far back days are read: a year, enough for any weekly streak shown.
HISTORY_DAYS = 366


@dataclass(frozen=True)
class PlanDay:
    day: date
    study_answers: int
    new_words: int
    practice_answers: int
    target: int
    completed_study: bool
    # Words covered by a finished spelling session that day (ADR 0016): shown, not required.
    spelled: int = 0
    # A finished study lesson that day left no review due (ADR 0022); sessions from before that
    # was recorded count as done.
    reviews_cleared: bool = True
    # Every card answered that day, practice and spelling included: the heatmap's shade.
    answers: int = 0

    @property
    def spelling_needed(self) -> int:
        """The planned new words of the day, each to be spelled once."""
        return min(self.new_words, self.target)

    @property
    def practised(self) -> bool:
        return self.study_answers > 0

    @property
    def plan_done(self) -> bool:
        # Every due review done and the day's new words met (ADR 0022). On a day with no new
        # word left, the target is 0 and the cleared reviews are the plan.
        if not self.practised or not self.completed_study or not self.reviews_cleared:
            return False
        return self.new_words >= self.target

    @property
    def planned_new(self) -> int:
        return min(self.new_words, self.target)

    @property
    def extra_new(self) -> int:
        return max(0, self.new_words - self.target)


def week_of(day: date) -> list[date]:
    """Monday to Sunday of the week holding `day`."""
    monday = day - timedelta(days=day.weekday())
    return [monday + timedelta(days=n) for n in range(7)]


def fallback_target(user: User, day: date, time_zone: ZoneInfo) -> int:
    """The target for a day with no recorded plan: today's settings, with that day's warm-up."""
    target = target_of(user)
    started = local_date(user.onboarded_at, time_zone) if user.onboarded_at else None
    return effective_target(target, ramp_week(target, user.ramp_enabled, started, day))


def zone_of(user: User) -> ZoneInfo:
    return ZoneInfo(user.time_zone or "UTC")


def days_by_user(
    db: Session, users: Sequence[User], since: datetime, time_zone: ZoneInfo | None = None
) -> dict[UUID, dict[date, PlanDay]]:
    """Every day with answers since `since`, per learner. Days are local to `time_zone`, or, when
    it is None (a group board), to each learner's own stored zone."""
    if not users:
        return {}
    zone = literal(time_zone.key) if time_zone else func.coalesce(User.time_zone, "UTC")
    local_day = func.date(func.timezone(zone, ReviewAttempt.answered_at))
    study = LearningSession.kind.not_in((PRACTICE, SPELLING))
    spelled = and_(LearningSession.kind == SPELLING, LearningSession.completed_at.is_not(None))
    rows = db.execute(
        select(
            ReviewAttempt.user_id,
            local_day,
            func.count().filter(study),
            func.count().filter(study, INTRODUCTION),
            func.count().filter(LearningSession.kind == PRACTICE),
            func.min(LearningSession.day_target).filter(study),
            func.bool_or(and_(study, LearningSession.completed_at.is_not(None))),
            func.max(LearningSession.spelling_words).filter(spelled),
            func.bool_or(
                and_(
                    study,
                    LearningSession.completed_at.is_not(None),
                    func.coalesce(LearningSession.reviews_left, 0) == 0,
                )
            ),
            func.count(),
        )
        .join(LearningSession, LearningSession.id == ReviewAttempt.session_id)
        .join(User, User.id == ReviewAttempt.user_id)
        .where(
            ReviewAttempt.user_id.in_([user.id for user in users]),
            ReviewAttempt.answered_at >= since,
        )
        .group_by(ReviewAttempt.user_id, local_day)
    )
    by_id = {user.id: user for user in users}
    result: dict[UUID, dict[date, PlanDay]] = {user.id: {} for user in users}
    for (
        user_id,
        day,
        study_answers,
        new_words,
        practice,
        recorded,
        completed,
        spelled_words,
        cleared,
        answers,
    ) in rows:
        user = by_id[user_id]
        target = (
            recorded
            if recorded is not None
            else fallback_target(user, day, time_zone or zone_of(user))
        )
        result[user_id][day] = PlanDay(
            day=day,
            study_answers=int(study_answers),
            new_words=int(new_words),
            practice_answers=int(practice),
            target=int(target),
            completed_study=bool(completed),
            spelled=int(spelled_words or 0),
            reviews_cleared=bool(cleared),
            answers=int(answers),
        )
    return result


def promises_by_user(
    db: Session, users: Sequence[User], since: datetime, time_zone: ZoneInfo | None = None
) -> dict[UUID, dict[date, int]]:
    """The days a week each learner promised, per week (keyed by its Monday): the promise on the
    week's first study session, so a change made mid-week applies from the next week."""
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
class WeekPlan:
    days: list[PlanDay | None]  # Monday to Sunday; None: no answers that day
    promised: int

    @property
    def done(self) -> list[bool]:
        return [day is not None and day.plan_done for day in self.days]

    @property
    def plan_days(self) -> int:
        return sum(self.done)

    @property
    def kept(self) -> int:
        """Plan days that count toward the promise: days beyond it are not a bigger result."""
        return min(self.plan_days, self.promised)

    @property
    def fulfilment(self) -> Fraction:
        return Fraction(self.kept, self.promised)

    @property
    def kept_promise(self) -> bool:
        return self.plan_days >= self.promised

    @property
    def active(self) -> bool:
        """Any answers this week, practice included: the learner showed up."""
        return any(day is not None for day in self.days)

    @property
    def planned_new(self) -> int:
        return sum(day.planned_new for day in self.days if day)

    @property
    def extra_new(self) -> int:
        return sum(day.extra_new for day in self.days if day)

    @property
    def practice_answers(self) -> int:
        return sum(day.practice_answers for day in self.days if day)


def week_plan(days: Mapping[date, PlanDay], week: Iterable[date], promised: int) -> WeekPlan:
    return WeekPlan(days=[days.get(day) for day in week], promised=promised)


def week_streak(
    days: Mapping[date, PlanDay], promises: Mapping[date, int], default: int, today: date
) -> int:
    """Weeks in a row with the promise kept, ending with this week once it is kept — or with last
    week, so a week still under way never shows a streak as broken."""
    monday = week_of(today)[0]

    def kept(week_start: date) -> bool:
        promised = promises.get(week_start, default)
        return week_plan(days, week_of(week_start), promised).kept_promise

    count = 1 if kept(monday) else 0
    week_start = monday - timedelta(days=7)
    while kept(week_start):
        count += 1
        week_start -= timedelta(days=7)
    return count
