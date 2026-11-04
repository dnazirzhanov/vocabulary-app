"""Keeps the database small (ADR 0044). Answers and lesson plans are by far its largest part, and
nothing reads them once they are old, so finished lessons give them up. What the screens still need
is kept first: a word's first recall on its progress (written as it happens), and each day's totals
in `study_day_totals`. A lesson's own row stays, for the deck it started and the promise."""

import time
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, literal, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import LearningSession, ReviewAttempt, StudyDayTotal, User
from app.services.progress import RECALL_RATE_DAYS
from app.services.study_days import HISTORY_DAYS

# Longer than anything reads answers for: the recall rate is the furthest back.
KEEP_ANSWERS = timedelta(days=RECALL_RATE_DAYS + 5)
KEEP_DAY_TOTALS = timedelta(days=HISTORY_DAYS + 35)
BATCH_SESSIONS = 500
# Stops in time for a free host's request limit; the next run carries on where this one stopped.
MAX_SECONDS = 50.0


@dataclass(frozen=True)
class Cleaned:
    lessons: int
    answers: int
    finished: bool


def _clean_batch(db: Session, cutoff: datetime) -> tuple[int, int]:
    """One transaction: totals are written and answers removed together, or neither."""
    ids = list(
        db.scalars(
            select(LearningSession.id)
            .where(
                LearningSession.completed_at < cutoff,
                # Literally as in the index's condition, so the index is used.
                text("plan <> '[]'::jsonb"),
            )
            .limit(BATCH_SESSIONS)
            .with_for_update(skip_locked=True)
        )
    )
    if not ids:
        return 0, 0
    day = func.date(func.timezone(func.coalesce(User.time_zone, "UTC"), ReviewAttempt.answered_at))
    totals = (
        select(ReviewAttempt.user_id, day.label("day"), func.count().label("answers"))
        .join(User, User.id == ReviewAttempt.user_id)
        .where(ReviewAttempt.session_id.in_(ids))
        .group_by(ReviewAttempt.user_id, day)
        .subquery()
    )
    statement = insert(StudyDayTotal).from_select(
        ["user_id", "day", "answers", "finished"],
        select(totals.c.user_id, totals.c.day, totals.c.answers, literal(True)),
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[StudyDayTotal.user_id, StudyDayTotal.day],
            set_={
                "answers": StudyDayTotal.answers + statement.excluded.answers,
                "finished": True,
            },
        )
    )
    removed = db.execute(delete(ReviewAttempt).where(ReviewAttempt.session_id.in_(ids)))
    db.execute(update(LearningSession).where(LearningSession.id.in_(ids)).values(plan=[]))
    db.commit()
    return len(ids), removed.rowcount  # type: ignore[attr-defined]


def clean_up(db: Session, now: datetime, max_seconds: float = MAX_SECONDS) -> Cleaned:
    """Safe to run at any time and to stop halfway. Unfinished lessons are left alone: they can
    still be resumed, and their answers are what says a deck was started."""
    started = time.monotonic()
    cutoff = now - KEEP_ANSWERS
    lessons = answers = 0
    while True:
        batch_lessons, batch_answers = _clean_batch(db, cutoff)
        lessons += batch_lessons
        answers += batch_answers
        if batch_lessons < BATCH_SESSIONS:
            break
        if time.monotonic() - started > max_seconds:
            return Cleaned(lessons, answers, finished=False)
    db.execute(delete(StudyDayTotal).where(StudyDayTotal.day < (now - KEEP_DAY_TOTALS).date()))
    db.commit()
    return Cleaned(lessons, answers, finished=True)
