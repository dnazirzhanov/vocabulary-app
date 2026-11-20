"""The coach for one learner (ADR 0071): their goal, this week's targets and progress, the study
time they promised, what to do now, and the one adjustment the weekly look back proposes. Reads the
learner's real activity; the rules themselves live in the sibling modules."""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import (
    LearningSession,
    MentorAdjustment,
    MentorDayOverride,
    MentorGoal,
    ReadingAnswer,
    ReviewAttempt,
    ScheduleEvent,
    ScheduleSkip,
    SpeakingSession,
    User,
    WritingSubmission,
)
from app.services import promise as promises
from app.services.coach import adapt
from app.services.coach.breakdown import Skill, Target, most_behind, weekly_targets, with_progress
from app.services.coach.goal import CEFR, Feasibility, Goal, GoalKind, feasibility
from app.services.coach.now import Now, what_now
from app.services.coach.windows import Block, Preference, StudyTime, propose
from app.services.study_days import days_by_user, week_of

# Minutes assumed for things whose length isn't recorded.
READING_MINUTES = 7
SPEAKING_MINUTES = 5
WRITING_MINUTES = 15
# A lesson left open counts no longer than this.
SESSION_CAP = 45
HABIT_DAYS = 28
DEFAULT_MINUTES = 20


# --- the goal -------------------------------------------------------------------------------


def active_goal(db: Session, user: User) -> MentorGoal | None:
    return db.scalar(
        select(MentorGoal).where(MentorGoal.user_id == user.id, MentorGoal.ended_at.is_(None))
    )


def course_level(db: Session, user: User) -> str | None:
    """The lower CEFR level of the highest course deck the learner has started («A1–A2» → A1)."""
    from app.services.mentor import _course_level

    found = re.findall(r"[ABC][12]", (_course_level(db, user) or "").upper())
    return found[0] if found and found[0] in CEFR else None


def set_goal(
    db: Session,
    user: User,
    kind: GoalKind,
    target: str | None,
    deadline: date | None,
    why: str | None,
    start_level: str | None,
    now: datetime,
) -> MentorGoal:
    """A new goal; the one before it ends (and stays as history)."""
    db.execute(
        update(MentorGoal)
        .where(MentorGoal.user_id == user.id, MentorGoal.ended_at.is_(None))
        .values(ended_at=now)
    )
    goal = MentorGoal(
        user_id=user.id,
        kind=kind,
        target=target,
        deadline=deadline,
        why=why,
        start_level=start_level or course_level(db, user),
        created_at=now,
    )
    db.add(goal)
    # The older screens read the goal's kind from here.
    user.mentor_goal = kind
    db.commit()
    return goal


def _goal_of(row: MentorGoal | None, user: User) -> Goal | None:
    if row is not None:
        return Goal(row.kind, row.target, row.deadline, row.why, row.start_level)  # type: ignore[arg-type]
    if user.mentor_goal in ("ielts", "conversation", "travel", "business", "academic", "general"):
        return Goal(user.mentor_goal)  # type: ignore[arg-type]
    return None


# --- the learner's real week ----------------------------------------------------------------


def _local_day(zone: ZoneInfo, moment: datetime) -> date:
    return moment.astimezone(zone).date()


def _local_minute(zone: ZoneInfo, moment: datetime) -> int:
    local = moment.astimezone(zone)
    return local.hour * 60 + local.minute


def _bounds(days: Sequence[date], zone: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(days[0], datetime.min.time(), zone)
    end = datetime.combine(days[-1] + timedelta(days=1), datetime.min.time(), zone)
    return start, end


def done_in(db: Session, user: User, days: Sequence[date], zone: ZoneInfo) -> dict[Skill, int]:
    """What the learner did in these days, in the targets' units."""
    since, until = _bounds(days, zone)
    words = db.scalar(
        select(func.count(func.distinct(ReviewAttempt.word_id))).where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.was_review.is_(False),
            ReviewAttempt.answered_at >= since,
            ReviewAttempt.answered_at < until,
        )
    )
    readings = db.scalar(
        select(func.count(func.distinct(ReadingAnswer.reading_ref))).where(
            ReadingAnswer.user_id == user.id,
            ReadingAnswer.sent_at >= since,
            ReadingAnswer.sent_at < until,
        )
    )
    essays = db.scalar(
        select(func.count()).where(
            WritingSubmission.user_id == user.id,
            WritingSubmission.status == "done",
            WritingSubmission.created_at >= since,
            WritingSubmission.created_at < until,
        )
    )
    answers = db.scalar(
        select(func.count()).where(
            SpeakingSession.user_id == user.id,
            SpeakingSession.status == "done",
            SpeakingSession.completed_at >= since,
            SpeakingSession.completed_at < until,
        )
    )
    return {
        "words": words or 0,
        "reading": readings or 0,
        "writing": essays or 0,
        "speaking": answers or 0,
    }


@dataclass(frozen=True)
class Activity:
    """When and how long the learner studied, by local day."""

    starts: dict[date, list[int]]
    minutes: dict[date, int]


def activity_in(db: Session, user: User, since: datetime, zone: ZoneInfo) -> Activity:
    starts: dict[date, list[int]] = {}
    minutes: dict[date, int] = {}

    def note(moment: datetime, length: float) -> None:
        day = _local_day(zone, moment)
        starts.setdefault(day, []).append(_local_minute(zone, moment))
        minutes[day] = minutes.get(day, 0) + round(length)

    for started, completed in db.execute(
        select(LearningSession.started_at, LearningSession.completed_at).where(
            LearningSession.user_id == user.id,
            LearningSession.completed_at.is_not(None),
            LearningSession.started_at >= since,
        )
    ):
        if completed is not None:
            length = (completed - started).total_seconds() / 60
            note(started, min(SESSION_CAP, max(1.0, length)))
    for created, spent in db.execute(
        select(WritingSubmission.created_at, WritingSubmission.time_spent_seconds).where(
            WritingSubmission.user_id == user.id, WritingSubmission.created_at >= since
        )
    ):
        note(created, (spent or WRITING_MINUTES * 60) / 60)
    for (completed,) in db.execute(
        select(SpeakingSession.completed_at).where(
            SpeakingSession.user_id == user.id,
            SpeakingSession.status == "done",
            SpeakingSession.completed_at >= since,
        )
    ):
        if completed is not None:
            note(completed, SPEAKING_MINUTES)
    for (sent,) in db.execute(
        select(func.min(ReadingAnswer.sent_at))
        .where(ReadingAnswer.user_id == user.id, ReadingAnswer.sent_at >= since)
        .group_by(ReadingAnswer.reading_ref)
    ):
        note(sent, READING_MINUTES)
    return Activity(starts, minutes)


def schedule_of(db: Session, user: User) -> list[tuple[str, Block]]:
    """The learner's repeating week (one-off blocks are a single day's, not the week's)."""
    return [
        (event.title, Block(event.weekdays, event.start_minute, event.end_minute))
        for event in db.scalars(
            select(ScheduleEvent).where(
                ScheduleEvent.user_id == user.id, ScheduleEvent.on_date.is_(None)
            )
        )
    ]


def repeating_on(db: Session, user: User, day: date) -> list[tuple[Any, str]]:
    """The repeating blocks on a date's weekday, as (id, title): what a skip can take off."""
    mask = 1 << day.weekday()
    return [
        (event.id, event.title)
        for event in db.scalars(
            select(ScheduleEvent)
            .where(ScheduleEvent.user_id == user.id, ScheduleEvent.on_date.is_(None))
            .order_by(ScheduleEvent.start_minute)
        )
        if event.weekdays & mask
    ]


def blocks_on(db: Session, user: User, day: date) -> list[tuple[str, Block]]:
    """One date's blocks (ADR 0074): the repeating ones not skipped that day, and that day's
    one-offs. Each carries the date's weekday."""
    mask = 1 << day.weekday()
    skipped = set(
        db.scalars(
            select(ScheduleSkip.event_id)
            .join(ScheduleEvent, ScheduleEvent.id == ScheduleSkip.event_id)
            .where(ScheduleEvent.user_id == user.id, ScheduleSkip.date == day)
        )
    )
    found: list[tuple[str, Block]] = []
    for event in db.scalars(select(ScheduleEvent).where(ScheduleEvent.user_id == user.id)):
        repeats = event.on_date is None and event.weekdays & mask and event.id not in skipped
        if repeats or event.on_date == day:
            found.append((event.title, Block(mask, event.start_minute, event.end_minute)))
    return found


# --- the coach, put together ----------------------------------------------------------------


@dataclass(frozen=True)
class Commitment:
    weekdays: int
    start_minute: int | None
    minutes: int | None
    # The study time takes effect from this day (tomorrow, after a change).
    pending_from: date | None = None


@dataclass(frozen=True)
class CoachState:
    goal: MentorGoal | None
    feasibility: Feasibility | None
    week_start: date
    targets: list[Target]
    behind: list[Skill]
    promised: list[bool]
    studied: list[bool]
    commitment: Commitment
    adjustment: MentorAdjustment | None
    today: "Today"


@dataclass(frozen=True)
class Today:
    """Today against the promise (ADR 0074): what was chosen when it didn't work, whether it is
    done, and whether yesterday's promise was missed (never twice in a row)."""

    override_mode: str | None
    override_start: int | None
    studied: bool
    promised: bool
    missed_yesterday: bool


def _commitment(promise: promises.Promise, today: date) -> Commitment:
    tomorrow = today + timedelta(days=1)
    now_time = promise.time_on(today)
    next_time = promise.time_on(tomorrow)
    mask = promise.mask_on(tomorrow)
    pending = tomorrow if next_time != now_time or mask != promise.mask_on(today) else None
    start, minutes = next_time if next_time else (None, None)
    return Commitment(mask, start, minutes, pending)


def coach_state(db: Session, user: User, now: datetime, zone: ZoneInfo) -> CoachState:
    today = now.astimezone(zone).date()
    week = week_of(today)
    promise = promises.promise_of(db, user)
    commitment = _commitment(promise, today)
    minutes_a_day = commitment.minutes or user.mentor_daily_minutes or DEFAULT_MINUTES
    days_a_week = max(1, bin(commitment.weekdays).count("1"))
    row = active_goal(db, user)
    goal = _goal_of(row, user)
    seen = feasibility(goal, minutes_a_day, days_a_week, today) if goal else None
    targets = (
        with_progress(
            weekly_targets(goal.kind, minutes_a_day * days_a_week), done_in(db, user, week, zone)
        )
        if goal
        else []
    )
    local = now.astimezone(zone)
    week_share = (today.weekday() + (local.hour * 60 + local.minute) / 1440) / 7
    since = datetime.combine(week[0], datetime.min.time(), zone)
    studied_days = days_by_user(db, [user], since, zone)[user.id]
    activity = activity_in(db, user, since, zone)
    studied = [
        (studied_days.get(day) is not None and studied_days[day].studied) or day in activity.minutes
        for day in week
    ]
    adjustment = weekly_review(db, user, now, zone, promise, seen)
    yesterday = today - timedelta(days=1)
    before = activity_in(
        db, user, datetime.combine(yesterday, datetime.min.time(), zone), zone
    ).minutes
    override = db.get(MentorDayOverride, (user.id, today))
    today_state = Today(
        override_mode=override.mode if override else None,
        override_start=override.start_minute if override else None,
        studied=bool(studied[today.weekday()]),
        promised=promise.promised_on(today),
        # Only once a study time was promised for that day: a new learner has missed nothing.
        missed_yesterday=promise.promised_on(yesterday)
        and promise.time_on(yesterday) is not None
        and not before.get(yesterday)
        and not (studied_days.get(yesterday) and studied_days[yesterday].studied),
    )
    return CoachState(
        goal=row,
        feasibility=seen,
        week_start=week[0],
        targets=targets,
        behind=most_behind(targets, week_share),
        promised=[promise.promised_on(day) for day in week],
        studied=studied,
        commitment=commitment,
        adjustment=adjustment,
        today=today_state,
    )


# --- when today doesn't work (ADR 0074) ------------------------------------------------------

RESCUE_MODES = ("minimum", "moved", "skip")


def set_today(
    db: Session,
    user: User,
    mode: str | None,
    start_minute: int | None,
    now: datetime,
    zone: ZoneInfo,
) -> None:
    """Today's choice: the 5-minute minimum, moved to a later time, or skipped (tomorrow keeps its
    usual load). None undoes it."""
    today = now.astimezone(zone).date()
    found = db.get(MentorDayOverride, (user.id, today))
    if mode is None:
        if found is not None:
            db.delete(found)
    elif found is None:
        db.add(
            MentorDayOverride(
                user_id=user.id, date=today, mode=mode, start_minute=start_minute, created_at=now
            )
        )
    else:
        found.mode, found.start_minute, found.created_at = mode, start_minute, now
    db.commit()


# --- study times and the commitment ---------------------------------------------------------


def study_times(
    db: Session,
    user: User,
    weekdays: int,
    minutes: int,
    preference: Preference | None,
    now: datetime,
    zone: ZoneInfo,
) -> list[StudyTime]:
    since = now - timedelta(days=HABIT_DAYS)
    habit = [m for day in activity_in(db, user, since, zone).starts.values() for m in day]
    return propose(
        [block for _, block in schedule_of(db, user)], weekdays, minutes, habit, preference
    )


def commit(
    db: Session,
    user: User,
    weekdays: Sequence[int],
    start_minute: int,
    minutes: int,
    today: date,
) -> None:
    """The learner's promise (ADR 0039) with its study time: these days, at this time, this long,
    from tomorrow."""
    if not weekdays:
        raise ApiError(400, "no_days", "Choose at least one day")
    promises.set_weekdays(db, user, weekdays, today, (start_minute, minutes))
    user.mentor_daily_minutes = minutes
    db.commit()


# --- what now -------------------------------------------------------------------------------


def now_for(
    db: Session, user: User, tasks: Sequence[Mapping[str, Any]], now: datetime, zone: ZoneInfo
) -> Now:
    local = now.astimezone(zone)
    time = promises.promise_of(db, user).time_on(local.date())
    return what_now(
        tasks,
        blocks_on(db, user, local.date()),
        local.weekday(),
        local.hour * 60 + local.minute,
        time[0] if time else None,
        time[1] if time else None,
    )


# --- the weekly look back -------------------------------------------------------------------


def weekly_review(
    db: Session,
    user: User,
    now: datetime,
    zone: ZoneInfo,
    promise: promises.Promise,
    seen: Feasibility | None,
) -> MentorAdjustment | None:
    """This week's adjustment: proposed once, from last week, and kept with what was decided."""
    today = now.astimezone(zone).date()
    week_start = week_of(today)[0]
    existing = db.scalar(
        select(MentorAdjustment).where(
            MentorAdjustment.user_id == user.id, MentorAdjustment.week_start == week_start
        )
    )
    if existing is not None:
        return existing if existing.status == "proposed" else None
    last_week = week_of(week_start - timedelta(days=1))
    time = promise.time_on(last_week[-1])
    if time is None or promise.time_on(last_week[0]) is None:
        # Nothing promised at a time, or not for the whole week: too little to judge from.
        return None
    since = datetime.combine(last_week[0], datetime.min.time(), zone)
    activity = activity_in(db, user, since, zone)
    # Only days the study time was already promised on count: not the days before it.
    promised_days = [
        day for day in last_week if promise.promised_on(day) and promise.time_on(day) is not None
    ]
    kept_days = [day for day in promised_days if activity.minutes.get(day)]
    studied = [day for day in last_week if day in activity.minutes]
    week = adapt.Week(
        promised=len(promised_days),
        kept=len(kept_days),
        starts=[min(activity.starts[day]) for day in studied],
        minutes_studied=[activity.minutes[day] for day in studied],
        commit_start=time[0],
        commit_minutes=time[1],
        commit_days=bin(promise.mask_on(last_week[-1])).count("1"),
        goal=seen.status if seen else "open",
    )
    proposal = adapt.review(week)
    if proposal is None:
        return None
    adjustment = MentorAdjustment(
        user_id=user.id,
        week_start=week_start,
        kind=proposal.kind,
        evidence={
            "promised": week.promised,
            "kept": week.kept,
            "usual_start": round(median(week.starts)) if week.starts else None,
            "usual_minutes": round(median(week.minutes_studied)) if week.minutes_studied else None,
            "start": week.commit_start,
            "minutes": week.commit_minutes,
        },
        proposal={"minutes": proposal.minutes, "days": proposal.days, "start": proposal.start},
        status="proposed",
        created_at=now,
    )
    db.add(adjustment)
    db.commit()
    return adjustment


def decide(
    db: Session, user: User, adjustment_id: Any, accept: bool, now: datetime, zone: ZoneInfo
) -> None:
    """The learner's answer to an adjustment. Accepted, it changes the promise from tomorrow."""
    row = db.scalar(
        select(MentorAdjustment).where(
            MentorAdjustment.id == adjustment_id, MentorAdjustment.user_id == user.id
        )
    )
    if row is None:
        raise ApiError(404, "not_found", "No such adjustment")
    if row.status != "proposed":
        return
    row.status, row.decided_at = ("accepted" if accept else "dismissed"), now
    if accept and row.kind != "behind":
        today = now.astimezone(zone).date()
        promise = promises.promise_of(db, user)
        days = promises.weekdays_of(promise.mask_on(today + timedelta(days=1)))
        start, minutes = promise.time_on(today + timedelta(days=1)) or (18 * 60, DEFAULT_MINUTES)
        if row.kind == "fewer_days" and len(days) > 1:
            days = days[:-1]  # the last promised day of the week goes
        start = row.proposal.get("start") or start
        minutes = row.proposal.get("minutes") or minutes
        commit(db, user, days, start, minutes, today)
    db.commit()
