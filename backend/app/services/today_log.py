"""What the learner practised today, from the app's own records, so the mentor can say exactly
what was done, when, and what was started but not finished. Lessons (words, spelling), writing,
speaking and reading, each at the learner's local time."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Deck,
    LearningSession,
    ReadingAnswer,
    SpeakingSession,
    User,
    WritingSubmission,
)
from app.services.progress import local_day_bounds
from app.services.reading import library_titles_with_level
from app.services.writing import questions as writing_questions

# A lesson longer than this was most likely left open: count no more than this.
LESSON_CAP = 60


@dataclass(frozen=True)
class Practice:
    at: datetime  # local
    kind: str  # vocab, spelling, writing, speaking, reading
    title: str
    minutes: int | None
    finished: bool
    end: datetime | None = None  # local
    detail: str = ""


def practice_today(db: Session, user: User, now: datetime, zone: ZoneInfo) -> list[Practice]:
    """Today's practice in the order it happened; an open lesson started today is listed as not
    finished."""
    return practice_on(db, user, now.astimezone(zone).date(), zone)


def practice_on(db: Session, user: User, day: date, zone: ZoneInfo) -> list[Practice]:
    """One local day's practice in the order it happened."""
    start, end = local_day_bounds(day, zone)
    found: list[Practice] = []

    lessons = db.execute(
        select(LearningSession, Deck.title)
        .outerjoin(Deck, Deck.id == LearningSession.deck_id)
        .where(
            LearningSession.user_id == user.id,
            LearningSession.started_at < end,
            (
                (LearningSession.completed_at >= start)
                | (
                    LearningSession.completed_at.is_(None)
                    & LearningSession.set_aside_at.is_(None)
                    & (LearningSession.started_at >= start)
                )
            ),
        )
    ).all()
    for lesson, deck_title in lessons:
        kind = "spelling" if lesson.kind == "spelling" else "vocab"
        done = lesson.completed_at
        minutes = (
            max(1, min(LESSON_CAP, round((done - lesson.started_at).total_seconds() / 60)))
            if done
            else None
        )
        found.append(
            Practice(
                at=lesson.started_at.astimezone(zone),
                kind=kind,
                title=deck_title or "",
                minutes=minutes,
                finished=done is not None,
                end=done.astimezone(zone) if done else None,
            )
        )

    for created, question_id, spent, status in db.execute(
        select(
            WritingSubmission.created_at,
            WritingSubmission.question_id,
            WritingSubmission.time_spent_seconds,
            WritingSubmission.status,
        ).where(
            WritingSubmission.user_id == user.id,
            WritingSubmission.created_at >= start,
            WritingSubmission.created_at < end,
        )
    ):
        question = writing_questions.get(question_id)
        found.append(
            Practice(
                at=created.astimezone(zone),
                kind="writing",
                title=question.title if question else "",
                minutes=round(spent / 60) if spent else None,
                finished=True,
                detail="checked" if status == "done" else "sent",
            )
        )

    for started, completed, exercise in db.execute(
        select(
            SpeakingSession.started_at,
            SpeakingSession.completed_at,
            SpeakingSession.exercise_type,
        ).where(
            SpeakingSession.user_id == user.id,
            SpeakingSession.status == "done",
            SpeakingSession.completed_at >= start,
            SpeakingSession.completed_at < end,
        )
    ):
        if completed is None:
            continue
        found.append(
            Practice(
                at=started.astimezone(zone),
                kind="speaking",
                title=exercise,
                minutes=max(1, round((completed - started).total_seconds() / 60)),
                finished=True,
                end=completed.astimezone(zone),
            )
        )

    articles = library_titles_with_level()
    for ref, first, last, answers in db.execute(
        select(
            ReadingAnswer.reading_ref,
            func.min(ReadingAnswer.sent_at),
            func.max(ReadingAnswer.sent_at),
            func.count(),
        )
        .where(
            ReadingAnswer.user_id == user.id,
            ReadingAnswer.sent_at >= start,
            ReadingAnswer.sent_at < end,
        )
        .group_by(ReadingAnswer.reading_ref)
    ):
        found.append(
            Practice(
                at=first.astimezone(zone),
                kind="reading",
                title=articles.get(ref, (ref, ""))[0],
                minutes=None,
                finished=True,
                end=last.astimezone(zone) if last - first > timedelta(minutes=1) else None,
                detail=f"{answers} answers",
            )
        )
    return sorted(found, key=lambda p: p.at)


KIND_NAMES = {
    "vocab": "Words",
    "spelling": "Spelling",
    "writing": "Writing",
    "speaking": "Speaking",
    "reading": "Reading",
}


def lines(log: list[Practice]) -> str:
    """The log for the prompt, one line each, local times."""
    if not log:
        return "Practice today so far: nothing yet (the app's records are complete).\n"
    out = [
        "Practice today so far (the app's own records, complete: what isn't here wasn't done "
        "today):"
    ]
    for p in log:
        when = p.at.strftime("%H:%M") + (f"–{p.end.strftime('%H:%M')}" if p.end else "")
        title = f" «{p.title}»" if p.title else ""
        facts = [f for f in (f"{p.minutes} min" if p.minutes else "", p.detail) if f]
        state = "finished" if p.finished else "started, NOT finished"
        details = f" ({', '.join(facts)})" if facts else ""
        out.append(f"  - {when} {KIND_NAMES[p.kind]}{title}{details}: {state}")
    return "\n".join(out) + "\n"
