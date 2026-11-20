"""What the mentor can look up about its learner (ADR 0079): every part of the app, the learner's
own data only, facts only. Each returns plain JSON-able data for the model; none writes."""

from collections.abc import Mapping
from datetime import date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    LearningSession,
    MentorDayOverride,
    ReadingAnswer,
    ReviewAttempt,
    SpeakingAssessment,
    SpeakingFeedbackItem,
    SpeakingSession,
    User,
    UserWordProgress,
    Word,
    WritingSubmission,
)
from app.services import decks, pace
from app.services import promise as promises
from app.services.coach import service as coach
from app.services.progress import local_day_bounds
from app.services.reading import library_titles_with_level
from app.services.today_log import KIND_NAMES, Practice, practice_on
from app.services.writing import questions as writing_questions

MAX_DAYS = 31  # one lookup of practice covers at most a month
BACK_DAYS = 90  # and reaches no further back than this
LIST_MAX = 20

WordState = Literal["struggling", "due", "learned", "new"]


def _hhmm(moment: datetime) -> str:
    return moment.strftime("%H:%M")


def parse_day(text: Any, today: date) -> date | None:
    """YYYY-MM-DD, or today / yesterday; None if neither."""
    said = str(text or "").strip().lower()
    if said == "today":
        return today
    if said == "yesterday":
        return today - timedelta(days=1)
    try:
        return date.fromisoformat(said[:10])
    except ValueError:
        return None


# --- practice -------------------------------------------------------------------------------


def _practice_line(p: Practice) -> dict[str, Any]:
    return {
        "time": _hhmm(p.at) + (f"–{_hhmm(p.end)}" if p.end else ""),
        "what": KIND_NAMES[p.kind],
        "title": p.title or None,
        "minutes": p.minutes,
        "finished": p.finished,
        **({"detail": p.detail} if p.detail else {}),
    }


def practice(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """Each day's practice between two dates (default: the last 7 days, today included)."""
    today = now.astimezone(zone).date()
    end = parse_day(args.get("to"), today) or today
    start = parse_day(args.get("from"), today) or end - timedelta(days=6)
    end = min(end, today)
    start = max(start, today - timedelta(days=BACK_DAYS), end - timedelta(days=MAX_DAYS - 1))
    if start > end:
        return {"error": "the dates are the wrong way round or in the future"}
    days: dict[str, list[dict[str, Any]]] = {}
    day = start
    while day <= end:
        found = practice_on(db, user, day, zone)
        if found:
            days[day.isoformat()] = [_practice_line(p) for p in found]
        day += timedelta(days=1)
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "days_practised": sum(any(p["finished"] for p in v) for v in days.values()),
        "days": days,
        "note": "complete records: a day not listed had no practice in the app",
    }


# --- words ----------------------------------------------------------------------------------


def words(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """Words by state: struggling (forgotten after being learned, most often first), due for
    review, recently learned, or new this week; with how many there are in each state."""
    asked = str(args.get("state") or "")
    state = asked if asked in ("struggling", "due", "learned", "new") else "due"
    try:
        limit = max(1, min(LIST_MAX, int(args.get("limit") or 10)))
    except (TypeError, ValueError):
        limit = 10
    mine = UserWordProgress.user_id == user.id
    week_ago = now - timedelta(days=7)
    conditions = {
        "struggling": UserWordProgress.lapses > 0,
        "due": UserWordProgress.due_at <= now,
        "learned": UserWordProgress.first_recalled_at.is_not(None),
        "new": UserWordProgress.introduced_at >= week_ago,
    }
    order = {
        "struggling": (UserWordProgress.lapses.desc(), UserWordProgress.incorrect_count.desc()),
        "due": (UserWordProgress.due_at,),
        "learned": (UserWordProgress.first_recalled_at.desc(),),
        "new": (UserWordProgress.introduced_at.desc(),),
    }
    counts = {
        name: db.scalar(select(func.count()).where(mine, condition)) or 0
        for name, condition in conditions.items()
    }
    rows = db.execute(
        select(Word.headword, Word.translation, UserWordProgress)
        .join(UserWordProgress, UserWordProgress.word_id == Word.id)
        .where(mine, conditions[state])
        .order_by(*order[state])
        .limit(limit)
    ).all()
    return {
        "state": state,
        "counts": counts,
        "words": [
            {
                "word": headword,
                "translation": translation,
                "forgotten": progress.lapses,
                "wrong_answers": progress.incorrect_count,
                "next_review": progress.due_at.astimezone(zone).date().isoformat(),
            }
            for headword, translation, progress in rows
        ],
    }


# --- writing, speaking, reading -------------------------------------------------------------


def _limit(args: Mapping[str, Any]) -> int:
    try:
        return max(1, min(5, int(args.get("limit") or 3)))
    except (TypeError, ValueError):
        return 3


def writing(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """Recent essays with their feedback: level, the five scores (1–5), summary, what to improve."""
    rows = db.scalars(
        select(WritingSubmission)
        .where(WritingSubmission.user_id == user.id)
        .order_by(WritingSubmission.created_at.desc())
        .limit(_limit(args))
    ).all()
    essays = []
    for row in rows:
        question = writing_questions.get(row.question_id)
        found = row.evaluation or {}
        criteria = found.get("criteria") or {}
        essays.append(
            {
                "date": row.created_at.astimezone(zone).date().isoformat(),
                "question": question.title if question else row.question_id,
                "status": row.status,
                "words": len(row.answer.split()),
                "level": found.get("cefr_level"),
                "overall": found.get("overall"),
                "scores": {k: (v or {}).get("score") for k, v in criteria.items()} or None,
                "summary": found.get("summary"),
                "improve": (found.get("improvements") or [])[:3],
                "mistakes": len(found.get("corrections") or []),
            }
        )
    return {"essays": essays, "total": _count(db, WritingSubmission, user)}


def _count(db: Session, model: Any, user: User) -> int:
    return db.scalar(select(func.count()).where(model.user_id == user.id)) or 0


def speaking(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """Recent speaking with its scores (0–100) and the main corrections."""
    rows = db.execute(
        select(SpeakingSession, SpeakingAssessment)
        .join(SpeakingAssessment, SpeakingAssessment.session_id == SpeakingSession.id)
        .where(SpeakingSession.user_id == user.id, SpeakingSession.status == "done")
        .order_by(SpeakingSession.completed_at.desc())
        .limit(_limit(args))
    ).all()
    found = []
    for session, assessment in rows:
        fixes = db.scalars(
            select(SpeakingFeedbackItem)
            .where(SpeakingFeedbackItem.assessment_id == assessment.id)
            .limit(3)
        ).all()
        score = {
            name: round(value)
            for name, value in (
                ("overall", assessment.overall_score),
                ("pronunciation", assessment.pronunciation_score),
                ("fluency", assessment.fluency_score),
                ("vocabulary", assessment.vocabulary_score),
                ("grammar", assessment.grammar_score),
                ("coherence", assessment.coherence_score),
            )
            if value is not None
        }
        found.append(
            {
                "date": (session.completed_at or session.started_at)
                .astimezone(zone)
                .date()
                .isoformat(),
                "exercise": session.exercise_type,
                "scores": score,
                "corrections": [
                    {
                        "kind": f.category,
                        "said": f.original_text,
                        "better": f.corrected_text,
                        "why": f.explanation,
                    }
                    for f in fixes
                ],
            }
        )
    return {"sessions": found}


def reading(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """Recent articles answered: title, level, how many answers, how many choices were right."""
    articles = library_titles_with_level()
    rows = db.execute(
        select(
            ReadingAnswer.reading_ref,
            func.max(ReadingAnswer.sent_at).label("last"),
            func.count(),
            func.count().filter(ReadingAnswer.correct.is_(True)),
            func.count().filter(ReadingAnswer.correct.is_not(None)),
        )
        .where(ReadingAnswer.user_id == user.id)
        .group_by(ReadingAnswer.reading_ref)
        .order_by(func.max(ReadingAnswer.sent_at).desc())
        .limit(_limit(args))
    ).all()
    return {
        "articles": [
            {
                "title": articles.get(ref, (ref, None))[0],
                "level": articles.get(ref, (ref, None))[1],
                "date": last.astimezone(zone).date().isoformat(),
                "answers": answers,
                "choices_right": f"{right} of {checked}" if checked else None,
            }
            for ref, last, answers, right, checked in rows
        ]
    }


# --- groups' decks, a date, a period ---------------------------------------------------------


def assignments(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """Decks given by the learner's groups: from which group, the deadline, words left, today's."""
    found = []
    for given in decks.assigned_decks(db, user):
        plan = pace.day_plan(db, user, given.deck.id, now, zone)
        found.append(
            {
                "deck": given.deck.title,
                "group": given.group_name,
                "deadline": given.due_on.isoformat() if given.due_on else None,
                "words_left": pace.deck_left(db, user, given.deck),
                "new_words_today": plan.remaining,
            }
        )
    return {"assignments": found}


def calendar(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """A date's blocks, its kind of day, today's choice, and the promise that day."""
    today = now.astimezone(zone).date()
    day = parse_day(args.get("date"), today) or today
    if abs((day - today).days) > BACK_DAYS:
        return {"error": f"only {BACK_DAYS} days back or ahead"}
    promise = promises.promise_of(db, user)
    time = promise.time_on(day) if promise.promised_on(day) else None
    override = db.get(MentorDayOverride, (user.id, day))
    return {
        "date": day.isoformat(),
        "weekday": day.strftime("%A"),
        "blocks": [
            {
                "title": t,
                "kind": k,
                "start": f"{a // 60:02d}:{a % 60:02d}",
                "end": f"{b // 60:02d}:{b % 60:02d}",
            }
            for t, k, a, b in coach.today_blocks(db, user, day)
        ],
        "kind_of_day": coach.day_type_on(db, user, day),
        "changed": override.mode if override else None,
        "promised": promise.promised_on(day),
        "study_time": f"{time[0] // 60:02d}:{time[0] % 60:02d}, {time[1]} min" if time else None,
    }


def progress(
    db: Session, user: User, now: datetime, zone: ZoneInfo, args: Mapping[str, Any]
) -> dict[str, Any]:
    """A week (the last 7 days) or a month (the last 30): what was done, and the promise."""
    today = now.astimezone(zone).date()
    length = 30 if args.get("period") == "month" else 7
    first = today - timedelta(days=length - 1)
    start, _ = local_day_bounds(first, zone)
    activity = coach.activity_in(db, user, start, zone)
    promise = promises.promise_of(db, user)
    promised = [
        first + timedelta(days=n)
        for n in range(length)
        if promise.promised_on(first + timedelta(days=n))
    ]
    mine_since = (
        (WritingSubmission, WritingSubmission.created_at),
        (SpeakingSession, SpeakingSession.completed_at),
        (LearningSession, LearningSession.completed_at),
    )
    counts = {
        model.__tablename__: db.scalar(
            select(func.count()).where(model.user_id == user.id, column >= start)
        )
        or 0
        for model, column in mine_since
    }
    return {
        "period": f"{first.isoformat()} to {today.isoformat()}",
        "days_practised": sum(1 for d in activity.minutes if d >= first),
        "minutes": sum(m for d, m in activity.minutes.items() if d >= first),
        "lessons": counts["learning_sessions"],
        "essays": counts["writing_submissions"],
        "speaking": counts["speaking_sessions"],
        "articles": db.scalar(
            select(func.count(func.distinct(ReadingAnswer.reading_ref))).where(
                ReadingAnswer.user_id == user.id, ReadingAnswer.sent_at >= start
            )
        )
        or 0,
        "words_learned": db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id, UserWordProgress.first_recalled_at >= start
            )
        )
        or 0,
        "reviews": db.scalar(
            select(func.count()).where(
                ReviewAttempt.user_id == user.id, ReviewAttempt.answered_at >= start
            )
        )
        or 0,
        "promised_days": len(promised),
        "promised_days_kept": sum(1 for d in promised if activity.minutes.get(d)),
    }


LOOKUPS = {
    "get_practice": practice,
    "get_words": words,
    "get_writing": writing,
    "get_speaking": speaking,
    "get_reading": reading,
    "get_assignments": assignments,
    "get_calendar": calendar,
    "get_progress": progress,
}
