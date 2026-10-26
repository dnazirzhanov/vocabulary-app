"""Points, the daily goal and streaks: pure rules (ADR 0008).

Points reward evidence of learning, not activity: practice sessions earn nothing, so repeating
easy material cannot farm them, and each exercise has exactly one stored attempt, so nothing can be
counted twice.
"""

from collections.abc import Iterable
from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import DeckWord, LearningSession, ReviewAttempt, User, UserWordProgress
from app.schemas.learning import DayActivity, ProgressOut, RecallRate, WordStages
from app.services.scheduling import WELL_LEARNED_STAGE, local_date

INTRODUCED_POINTS = 10
RECALLED_POINTS = 20  # the strongest evidence: produced after a delay
MISSED_REVIEW_POINTS = 5  # the effort of reviewing still counts, less
DAILY_GOAL_POINTS = 30  # roughly one lesson or a short review; a pilot hypothesis
RECALL_RATE_DAYS = 30


def points_for(exercise_type: str, review_outcome: bool | None) -> int:
    """Points for one attempt. `review_outcome` is set only on the attempt that finishes a word in a
    review session (True = recalled)."""
    if exercise_type == "introduce":
        return INTRODUCED_POINTS
    if review_outcome is None:
        return 0
    return RECALLED_POINTS if review_outcome else MISSED_REVIEW_POINTS


def local_day_bounds(day: date, time_zone: ZoneInfo) -> tuple[datetime, datetime]:
    """[start, end) of a local calendar day as aware datetimes. A DST day is 23 or 25 hours long."""
    start = datetime.combine(day, time.min, tzinfo=time_zone)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=time_zone)
    return start, end


def streak(goal_days: Iterable[date], today: date) -> int:
    """Consecutive days on which the goal was met, ending today — or yesterday, so a streak is not
    shown as broken before today's practice has happened."""
    met = set(goal_days)
    day = today if today in met else today - timedelta(days=1)
    count = 0
    while day in met:
        count += 1
        day -= timedelta(days=1)
    return count


# --- database-backed views ------------------------------------------------------------------

STREAK_HISTORY_DAYS = 366


def _points_by_local_day(
    db: Session, user: User, since: datetime, time_zone: ZoneInfo
) -> dict[date, int]:
    # PostgreSQL converts each instant to the learner's wall clock, DST included.
    local_day = func.date(func.timezone(time_zone.key, ReviewAttempt.answered_at))
    rows = db.execute(
        select(local_day, func.sum(ReviewAttempt.points))
        .where(ReviewAttempt.user_id == user.id, ReviewAttempt.answered_at >= since)
        .group_by(local_day)
    )
    return {day: int(total) for day, total in rows}


def points_today(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> int:
    start, end = local_day_bounds(local_date(now, time_zone), time_zone)
    total = db.scalar(
        select(func.coalesce(func.sum(ReviewAttempt.points), 0)).where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.answered_at >= start,
            ReviewAttempt.answered_at < end,
        )
    )
    return int(total or 0)


def session_points(db: Session, session_id: UUID) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(ReviewAttempt.points), 0)).where(
            ReviewAttempt.session_id == session_id
        )
    )
    return int(total or 0)


def recall_counts(db: Session, user: User, now: datetime) -> tuple[int, int]:
    """(recalled, reviewed) in scheduled reviews over the last RECALL_RATE_DAYS."""
    reviewed, recalled = db.execute(
        select(func.count(), func.count().filter(ReviewAttempt.stage_after >= 2))
        .join(LearningSession, LearningSession.id == ReviewAttempt.session_id)
        .where(
            ReviewAttempt.user_id == user.id,
            LearningSession.kind == "review",
            ReviewAttempt.stage_after.is_not(None),
            ReviewAttempt.answered_at >= now - timedelta(days=RECALL_RATE_DAYS),
        )
    ).one()
    return int(recalled), int(reviewed)


def deck_progress(
    db: Session, user: User, deck_id: str, now: datetime, time_zone: ZoneInfo
) -> ProgressOut:
    mine = (
        select(UserWordProgress)
        .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
        .where(DeckWord.deck_id == deck_id, UserWordProgress.user_id == user.id)
        .subquery()
    )
    introduced, well_learned, due = db.execute(
        select(
            func.count(),
            func.count().filter(mine.c.stage >= WELL_LEARNED_STAGE),
            func.count().filter(mine.c.due_at <= now),
        ).select_from(mine)
    ).one()

    today = local_date(now, time_zone)
    history_start, _ = local_day_bounds(today - timedelta(days=STREAK_HISTORY_DAYS), time_zone)
    by_day = _points_by_local_day(db, user, history_start, time_zone)
    week = [today - timedelta(days=n) for n in range(6, -1, -1)]

    recalled, reviewed = recall_counts(db, user, now)
    total = db.scalar(
        select(func.coalesce(func.sum(ReviewAttempt.points), 0)).where(
            ReviewAttempt.user_id == user.id
        )
    )

    return ProgressOut(
        deck_id=deck_id,
        words=WordStages(
            introduced=introduced,
            reviewing=introduced - well_learned,
            well_learned=well_learned,
            due=due,
        ),
        today=DayActivity(date=today, points=by_day.get(today, 0)),
        daily_goal=DAILY_GOAL_POINTS,
        streak_days=streak(
            (day for day, points in by_day.items() if points >= DAILY_GOAL_POINTS), today
        ),
        week=[DayActivity(date=day, points=by_day.get(day, 0)) for day in week],
        recall=RecallRate(recalled=recalled, reviewed=reviewed, days=RECALL_RATE_DAYS),
        points_total=int(total or 0),
    )
