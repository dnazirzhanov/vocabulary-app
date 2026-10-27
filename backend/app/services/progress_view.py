"""The learner's own progress: the Progress page and today's plan after a lesson (ADR 0015)."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Deck, DeckWord, LearningSession, ReviewAttempt, User, UserWordProgress
from app.schemas.learning import (
    PlanDayOut,
    ProgressOut,
    RecallRate,
    SpellingTodayOut,
    TodayPlanOut,
    WordStages,
)
from app.services.learning import SPELLING_TYPES
from app.services.plan_days import (
    HISTORY_DAYS,
    PlanDay,
    days_by_user,
    fallback_target,
    promises_by_user,
    week_of,
    week_streak,
)
from app.services.progress import RECALL_RATE_DAYS, local_day_bounds, recall_counts
from app.services.scheduling import REVIEW, WELL_LEARNED_STABILITY_DAYS, local_date


def word_stages(db: Session, user: User, now: datetime) -> WordStages:
    """Words of every published level (a retired deck may still list words that moved on)."""
    mine = (
        select(UserWordProgress)
        .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(Deck.status == "published", UserWordProgress.user_id == user.id)
        .subquery()
    )
    introduced, well_learned, due = db.execute(
        select(
            func.count(),
            func.count().filter(
                (mine.c.fsrs_state == REVIEW) & (mine.c.stability >= WELL_LEARNED_STABILITY_DAYS)
            ),
            func.count().filter(mine.c.due_at <= now),
        ).select_from(mine)
    ).one()
    return WordStages(
        introduced=introduced,
        reviewing=introduced - well_learned,
        well_learned=well_learned,
        due=due,
    )


def _day_out(day: PlanDay) -> PlanDayOut:
    return PlanDayOut(
        date=day.day,
        active=True,
        plan_done=day.plan_done,
        new_words=day.new_words,
        target=day.target,
    )


def course_progress(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> ProgressOut:
    today = local_date(now, time_zone)
    since, _ = local_day_bounds(today - timedelta(days=HISTORY_DAYS), time_zone)
    days = days_by_user(db, [user], since, time_zone)[user.id]
    promises = promises_by_user(db, [user], since, time_zone)[user.id]
    monday = week_of(today)[0]
    recalled, reviewed = recall_counts(db, user, now)
    today_out = (
        _day_out(days[today])
        if today in days
        else PlanDayOut(
            date=today,
            active=False,
            plan_done=False,
            new_words=0,
            target=fallback_target(user, today, time_zone),
        )
    )
    return ProgressOut(
        words=word_stages(db, user, now),
        today=today_out,
        streak_weeks=week_streak(days, promises, user.study_days_per_week, today),
        activity=[_day_out(day) for _, day in sorted(days.items())],
        promised_days=promises.get(monday, user.study_days_per_week),
        recall=RecallRate(recalled=recalled, reviewed=reviewed, days=RECALL_RATE_DAYS),
        spelling_today=spelling_today(db, user, now, time_zone),
    )


def spelling_today(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> SpellingTodayOut:
    """The spelling sections of today's lessons: their words, and those finished."""
    start, end = local_day_bounds(local_date(now, time_zone), time_zone)
    sessions = db.scalars(
        select(LearningSession).where(
            LearningSession.user_id == user.id,
            LearningSession.kind != "hard",
            LearningSession.started_at >= start,
            LearningSession.started_at < end,
        )
    ).all()
    answered = {
        (session_id, exercise_id)
        for session_id, exercise_id in db.execute(
            select(ReviewAttempt.session_id, ReviewAttempt.exercise_id).where(
                ReviewAttempt.session_id.in_([session.id for session in sessions])
            )
        )
    }
    words: set[str] = set()
    unfinished: set[str] = set()
    for session in sessions:
        for step in session.plan:
            if step.get("type") not in SPELLING_TYPES:
                continue
            words.add(step["word_id"])
            if (session.id, step["id"]) not in answered:
                unfinished.add(step["word_id"])
    return SpellingTodayOut(words=len(words), done=len(words - unfinished))


def today_plan(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> TodayPlanOut:
    today = local_date(now, time_zone)
    start, _ = local_day_bounds(today, time_zone)
    day = days_by_user(db, [user], start, time_zone)[user.id].get(today)
    if day is None:
        target = fallback_target(user, today, time_zone)
        return TodayPlanOut(new_words=0, target=target, plan_done=False, extra_new=0)
    return TodayPlanOut(
        new_words=day.new_words,
        target=day.target,
        plan_done=day.plan_done,
        extra_new=day.extra_new,
    )
