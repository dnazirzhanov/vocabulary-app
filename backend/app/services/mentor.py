"""Personal Study Mentor chat: answers the learner's questions about their own progress,
plans, and vocabulary, using DeepSeek when a key is configured and a canned reply otherwise."""

import dataclasses
import time
from collections.abc import Generator
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.locale import texts_for
from app.core.logging import logger
from app.models import (
    Deck,
    DeckWord,
    LearningSession,
    MentorMessage,
    ReadingAnswer,
    ReviewAttempt,
    SpellingProgress,
    User,
    UserWordProgress,
)
from app.services.progress import local_day_bounds
from app.services.promise import promise_of, week_streak, weekdays_of
from app.services.reading import library_titles
from app.services.scheduling import local_date
from app.services.study_days import HISTORY_DAYS, days_by_user, week_of

# How many recent turns are sent as context in each API call.
_HISTORY_TURNS = 6

_LANGUAGE_NAMES: dict[str, str] = {
    "ru": "Russian",
    "en": "English",
    "uz": "Uzbek",
    "kk": "Kazakh",
    "ky": "Kyrgyz",
    "tg": "Tajik",
}


@dataclasses.dataclass
class LearnerContext:
    """All per-learner data passed into the system prompt; use keyword args in tests."""

    streak_weeks: int = 0
    sessions_today: str = "none"
    words_in_progress: int = 0
    words_learned: int = 0
    words_today: int = 0
    due_vocab: int = 0
    due_spelling: int = 0
    promised_days: str = "none"
    days_this_week: str = "0 days"
    retention: str = "no data yet"
    spelling_accuracy: str = "no data yet"
    last_study: str = "never"
    course_level: str | None = None
    deck_rows: list[tuple[str, int]] = dataclasses.field(default_factory=list)
    reading_total: int = 0
    reading_recent: list[str] = dataclasses.field(default_factory=list)


_SYSTEM = """\
You are a warm, encouraging personal study mentor for a learner studying English vocabulary.
Reply in {LANGUAGE}. Keep replies short and practical — 1 to 4 sentences unless the learner \
explicitly asks for more.
Never invent statistics you don't have.

Current learner state (use this to give personal, relevant advice):
- Name: {NAME}
- Local time: {LOCAL_TIME} ({TIME_OF_DAY})
- Study streak: {STREAK}
- Sessions completed today: {SESSIONS_TODAY}
- Last study session: {LAST_STUDY}
- Vocabulary in progress: {WORDS_IN_PROGRESS} words
- Vocabulary recalled at least once: {WORDS_LEARNED} words
- New words learned today: {WORDS_TODAY}
- Vocabulary due today: {DUE_VOCAB} words
- Spelling due today: {DUE_SPELLING} words
- Promised study days this week: {PROMISED_DAYS}
- Days studied this week: {DAYS_THIS_WEEK}
- Vocabulary retention rate (last 7 days): {RETENTION}
- Spelling accuracy (last 7 days): {SPELLING_ACCURACY}
{PACE_LINE}{LEVEL_LINE}{GOAL_LINE}{DECK_SECTION}{READING_SECTION}\
Help the learner decide what to study, encourage them, and answer questions about their progress.\
"""


def _time_of_day(hour: int) -> str:
    """'morning' / 'afternoon' / 'evening' / 'night' for a local hour (0–23)."""
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 21:
        return "evening"
    return "night"


def _sessions_today(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> str:
    """Human-readable summary of sessions completed today, or 'none'."""
    today = local_date(now, time_zone)
    day_start, day_end = local_day_bounds(today, time_zone)
    rows = db.execute(
        select(LearningSession.kind, func.count().label("n"))
        .where(
            LearningSession.user_id == user.id,
            LearningSession.completed_at >= day_start,
            LearningSession.completed_at < day_end,
        )
        .group_by(LearningSession.kind)
    ).all()
    if not rows:
        return "none"
    total = sum(row.n for row in rows)
    parts = ", ".join(f"{row.n} {row.kind}" for row in rows)
    return f"{total} ({parts})"


def _deck_context(db: Session, user: User, now: datetime) -> list[tuple[str, int]]:
    """Top 5 decks by due vocab count, returned as (title, count) pairs."""
    rows = db.execute(
        select(Deck.title, func.count(UserWordProgress.word_id).label("n"))
        .select_from(UserWordProgress)
        .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(
            UserWordProgress.user_id == user.id,
            UserWordProgress.due_at <= now,
        )
        .group_by(Deck.id, Deck.title, Deck.level_order)
        .order_by(func.count(UserWordProgress.word_id).desc(), Deck.level_order)
        .limit(5)
    ).all()
    return [(row.title, row.n) for row in rows]


def _reading_context(db: Session, user: User) -> tuple[int, list[str]]:
    """(total_library_articles_engaged, recent_titles_newest_first[0:2])."""
    rows = db.execute(
        select(ReadingAnswer.reading_ref, func.max(ReadingAnswer.sent_at).label("last"))
        .where(
            ReadingAnswer.user_id == user.id,
            ReadingAnswer.reading_ref.like("library:%"),
        )
        .group_by(ReadingAnswer.reading_ref)
        .order_by(func.max(ReadingAnswer.sent_at).desc())
    ).all()
    if not rows:
        return 0, []
    titles = library_titles()
    total = len(rows)
    recent = [titles[row.reading_ref] for row in rows[:2] if row.reading_ref in titles]
    return total, recent


def _vocab_summary(db: Session, user: User) -> tuple[int, int]:
    """(words_in_progress, words_learned) where learned = recalled at least once."""
    in_progress = db.scalar(select(func.count()).where(UserWordProgress.user_id == user.id)) or 0
    learned = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.first_recalled_at.is_not(None),
            )
        )
        or 0
    )
    return int(in_progress), int(learned)


def _course_level(db: Session, user: User) -> str | None:
    """The level string of the highest course deck the learner has started (e.g. 'B1')."""
    row = db.execute(
        select(Deck.level)
        .select_from(UserWordProgress)
        .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(
            UserWordProgress.user_id == user.id,
            Deck.kind == "course",
            Deck.level.is_not(None),
        )
        .order_by(Deck.level_order.desc())
        .limit(1)
    ).first()
    return row[0] if row else None


def _system_prompt(user: User, now: datetime, time_zone: ZoneInfo, ctx: LearnerContext) -> str:
    lang = user.ui_language or "ru"
    t = texts_for(lang)
    streak_text = (
        t.mentor_streak_none if ctx.streak_weeks == 0 else t.mentor_streak_weeks(ctx.streak_weeks)
    )
    name = user.name or t.mentor_learner_name
    local_dt = now.astimezone(time_zone)
    local_time = local_dt.strftime("%H:%M")
    time_label = _time_of_day(local_dt.hour)
    pace_line = (
        f"- Daily target: {user.daily_target_words} new words/day\n"
        if user.daily_target_words
        else ""
    )
    level_line = f"- Current course level: {ctx.course_level}\n" if ctx.course_level else ""
    goal_line = f"- Learning goal: {user.mentor_goal}\n" if user.mentor_goal else ""
    if ctx.deck_rows:
        lines = "\n".join(f"  - {title}: {n} words" for title, n in ctx.deck_rows)
        deck_section = f"Top decks due today (most due first):\n{lines}\n"
    else:
        deck_section = ""
    if ctx.reading_total > 0:
        recent_str = ", ".join(f'"{t}"' for t in ctx.reading_recent)
        reading_section = f"Library articles read: {ctx.reading_total}"
        if recent_str:
            reading_section += f" (most recent: {recent_str})"
        reading_section += "\n"
    else:
        reading_section = ""
    return (
        _SYSTEM.replace("{LANGUAGE}", _LANGUAGE_NAMES.get(lang, "Russian"))
        .replace("{NAME}", name)
        .replace("{LOCAL_TIME}", local_time)
        .replace("{TIME_OF_DAY}", time_label)
        .replace("{STREAK}", streak_text)
        .replace("{SESSIONS_TODAY}", ctx.sessions_today)
        .replace("{WORDS_IN_PROGRESS}", str(ctx.words_in_progress))
        .replace("{WORDS_LEARNED}", str(ctx.words_learned))
        .replace("{WORDS_TODAY}", str(ctx.words_today))
        .replace("{DUE_VOCAB}", str(ctx.due_vocab))
        .replace("{DUE_SPELLING}", str(ctx.due_spelling))
        .replace("{PROMISED_DAYS}", ctx.promised_days)
        .replace("{DAYS_THIS_WEEK}", ctx.days_this_week)
        .replace("{RETENTION}", ctx.retention)
        .replace("{SPELLING_ACCURACY}", ctx.spelling_accuracy)
        .replace("{LAST_STUDY}", ctx.last_study)
        .replace("{PACE_LINE}", pace_line)
        .replace("{LEVEL_LINE}", level_line)
        .replace("{GOAL_LINE}", goal_line)
        .replace("{DECK_SECTION}", deck_section)
        .replace("{READING_SECTION}", reading_section)
    )


_DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _learner_state(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> LearnerContext:
    """Build a LearnerContext from live DB state."""
    today = local_date(now, time_zone)
    since, _ = local_day_bounds(today - timedelta(days=HISTORY_DAYS), time_zone)
    days = days_by_user(db, [user], since, time_zone)[user.id]
    promise = promise_of(db, user)
    streak = week_streak(promise, days, today)

    promised = weekdays_of(promise.mask_on(today))
    promised_days_str = ", ".join(_DAY_NAMES[d] for d in promised) if promised else "none"

    this_week = week_of(today)
    studied_count = sum(1 for d in this_week if d in days and days[d].studied)
    promised_count = sum(1 for d in this_week if d.weekday() in promised)
    if promised_count > 0:
        days_this_week_str = f"{studied_count} of {promised_count} promised"
    else:
        days_this_week_str = f"{studied_count} {'day' if studied_count == 1 else 'days'}"

    due_vocab = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.due_at <= now,
            )
        )
        or 0
    )
    due_spelling = (
        db.scalar(
            select(func.count()).where(
                SpellingProgress.user_id == user.id,
                SpellingProgress.due_at <= now,
            )
        )
        or 0
    )
    last_at = db.scalar(
        select(func.max(LearningSession.completed_at)).where(LearningSession.user_id == user.id)
    )
    if last_at is None:
        last_study_label = "never"
    else:
        last_local = local_date(last_at, time_zone)
        delta = (today - last_local).days
        if delta == 0:
            last_study_label = "today"
        elif delta == 1:
            last_study_label = "yesterday"
        else:
            last_study_label = f"{delta} days ago"

    day_start, day_end = local_day_bounds(today, time_zone)
    words_today = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.first_recalled_at >= day_start,
                UserWordProgress.first_recalled_at < day_end,
            )
        )
        or 0
    )

    week_ago = now - timedelta(days=7)
    retention_row = db.execute(
        select(
            func.count(ReviewAttempt.id).label("total"),
            func.sum(case((ReviewAttempt.rating >= 2, 1), else_=0)).label("retained"),
        ).where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.answered_at >= week_ago,
            ReviewAttempt.rating.is_not(None),
        )
    ).first()
    if retention_row and retention_row.total:
        pct = round(100 * (retention_row.retained or 0) / retention_row.total)
        retention_str = f"{pct}%"
    else:
        retention_str = "no data yet"

    spelling_row = db.execute(
        select(
            func.count(ReviewAttempt.id).label("total"),
            func.sum(case((ReviewAttempt.correct.is_(True), 1), else_=0)).label("correct"),
        ).where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.answered_at >= week_ago,
            ReviewAttempt.exercise_type == "spelling",
            ReviewAttempt.correct.is_not(None),
        )
    ).first()
    if spelling_row and spelling_row.total:
        spell_pct = round(100 * (spelling_row.correct or 0) / spelling_row.total)
        spelling_accuracy_str = f"{spell_pct}%"
    else:
        spelling_accuracy_str = "no data yet"

    return LearnerContext(
        streak_weeks=streak,
        due_vocab=int(due_vocab),
        due_spelling=int(due_spelling),
        promised_days=promised_days_str,
        days_this_week=days_this_week_str,
        retention=retention_str,
        spelling_accuracy=spelling_accuracy_str,
        last_study=last_study_label,
        words_today=int(words_today),
    )


def _recent_history(db: Session, user: User) -> list[MentorMessage]:
    return list(
        db.scalars(
            select(MentorMessage)
            .where(MentorMessage.user_id == user.id)
            .order_by(MentorMessage.created_at.desc())
            .limit(_HISTORY_TURNS * 2)
        )
    )[::-1]


def history(db: Session, user: User) -> list[MentorMessage]:
    """The last 20 messages for display in the chat UI."""
    msgs = list(
        db.scalars(
            select(MentorMessage)
            .where(MentorMessage.user_id == user.id)
            .order_by(MentorMessage.created_at.desc())
            .limit(20)
        )
    )[::-1]
    # Drop a trailing orphaned user message: a stream that started but failed before
    # _persist ran leaves the user message without a following assistant reply.
    if msgs and msgs[-1].role == "user":
        msgs = msgs[:-1]
    return msgs


def clear_history(db: Session, user: User) -> None:
    """Delete all stored messages for this user."""
    from sqlalchemy import delete

    db.execute(delete(MentorMessage).where(MentorMessage.user_id == user.id))
    db.commit()


def _persist(db: Session, user: User, user_text: str, assistant_text: str, now: datetime) -> None:
    db.add(MentorMessage(user_id=user.id, role="user", content=user_text, created_at=now))
    # +1 µs so the assistant message always sorts after the user message even when both are saved
    # with the same clock reading (which happens in tests and can happen in fast demo mode).
    db.add(
        MentorMessage(
            user_id=user.id,
            role="assistant",
            content=assistant_text,
            created_at=now + timedelta(microseconds=1),
        )
    )
    db.commit()


def _build_context(
    db: Session,
    user: User,
    message: str,
    settings: Settings,
    now: datetime,
    time_zone: ZoneInfo,
) -> tuple[str, list[dict[str, str]], str, bool]:
    """Return (system_prompt, messages, demo_reply_or_empty, is_demo)."""
    ctx = _learner_state(db, user, now, time_zone)
    words_in_progress, words_learned = _vocab_summary(db, user)
    ctx.words_in_progress = words_in_progress
    ctx.words_learned = words_learned
    ctx.course_level = _course_level(db, user)
    ctx.deck_rows = _deck_context(db, user, now)
    ctx.reading_total, ctx.reading_recent = _reading_context(db, user)
    ctx.sessions_today = _sessions_today(db, user, now, time_zone)
    system = _system_prompt(user, now, time_zone, ctx)
    history = _recent_history(db, user)
    demo = settings.mentor_chat_demo or (
        not settings.deepseek_api_key and settings.environment != "production"
    )
    if demo:
        return system, [], texts_for(user.ui_language).mentor_demo_reply, True
    if not settings.deepseek_api_key:
        raise ApiError(503, "mentor_unavailable", "The mentor service is not configured")
    msgs: list[dict[str, str]] = [{"role": m.role, "content": m.content} for m in history]
    msgs.append({"role": "user", "content": message})
    return system, msgs, "", False


def chat(
    db: Session,
    user: User,
    message: str,
    settings: Settings,
    now: datetime,
    time_zone: ZoneInfo,
) -> str:
    """Send a message to the mentor and return the assistant's reply."""
    system, msgs, demo_reply, is_demo = _build_context(db, user, message, settings, now, time_zone)
    if is_demo:
        _persist(db, user, message, demo_reply, now)
        return demo_reply
    reply = _call_deepseek(system, msgs, settings)
    _persist(db, user, message, reply, now)
    return reply


def stream_chat(
    db: Session,
    user: User,
    message: str,
    settings: Settings,
    now: datetime,
    time_zone: ZoneInfo,
) -> Generator[str]:
    """Yield text chunks from DeepSeek (or a word-by-word demo reply), then persist."""

    system, msgs, demo_reply, is_demo = _build_context(db, user, message, settings, now, time_zone)
    if is_demo:
        _persist(db, user, message, demo_reply, now)
        delay = settings.mentor_demo_stream_delay_ms / 1000
        words = demo_reply.split(" ")
        for i, word in enumerate(words):
            chunk = word if i == len(words) - 1 else word + " "
            if delay > 0:
                time.sleep(delay)
            yield chunk
        return
    accumulated: list[str] = []
    for chunk in _stream_deepseek(system, msgs, settings):
        accumulated.append(chunk)
        yield chunk
    full_reply = "".join(accumulated) or " "
    _persist(db, user, message, full_reply, now)


def _stream_deepseek(
    system: str, messages: list[dict[str, str]], settings: Settings
) -> Generator[str]:
    """Yield text chunks from DeepSeek using the streaming API."""
    import openai
    from openai.types.chat import ChatCompletionMessageParam

    from app.services.generation import DEEPSEEK_URL, TIMEOUT_SECONDS

    client = openai.OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=DEEPSEEK_URL,
        timeout=TIMEOUT_SECONDS,
        max_retries=0,
    )
    all_messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}]
    for m in messages:
        role = m["role"]
        if role == "user":
            all_messages.append({"role": "user", "content": m["content"]})
        elif role == "assistant":
            all_messages.append({"role": "assistant", "content": m["content"]})
    try:
        stream = client.chat.completions.create(
            model=settings.deepseek_model,
            max_tokens=512,
            messages=all_messages,
            extra_body={"thinking": {"type": "disabled"}},
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta
    except openai.AuthenticationError as error:
        raise ApiError(503, "mentor_unavailable", "The mentor service key is wrong") from error
    except openai.RateLimitError as error:
        raise ApiError(503, "mentor_busy", "The mentor service is busy") from error
    except openai.APIStatusError as error:
        if error.status_code == 402:
            raise ApiError(
                503, "mentor_no_credits", "The mentor account is out of credit"
            ) from error
        raise ApiError(502, "mentor_failed", "The mentor service did not answer") from error
    except openai.APIConnectionError as error:
        raise ApiError(502, "mentor_failed", "The mentor service did not answer") from error


def _call_deepseek(system: str, messages: list[dict[str, str]], settings: Settings) -> str:
    import openai
    from openai.types.chat import ChatCompletionMessageParam

    # Lazy import: same pattern as generation.py — only load when actually used (ADR 0044).
    from app.services.generation import DEEPSEEK_URL, TIMEOUT_SECONDS

    client = openai.OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=DEEPSEEK_URL,
        timeout=TIMEOUT_SECONDS,
        max_retries=1,
    )
    # Build typed message list; role values come from our CHECK constraint so the cast is safe.
    all_messages: list[ChatCompletionMessageParam] = []
    all_messages.append({"role": "system", "content": system})
    for m in messages:
        role = m["role"]
        if role == "user":
            all_messages.append({"role": "user", "content": m["content"]})
        elif role == "assistant":
            all_messages.append({"role": "assistant", "content": m["content"]})
    try:
        response = client.chat.completions.create(
            model=settings.deepseek_model,
            max_tokens=512,
            messages=all_messages,
            extra_body={"thinking": {"type": "disabled"}},
        )
    except openai.AuthenticationError as error:
        raise ApiError(503, "mentor_unavailable", "The mentor service key is wrong") from error
    except openai.RateLimitError as error:
        raise ApiError(503, "mentor_busy", "The mentor service is busy") from error
    except openai.APIStatusError as error:
        if error.status_code == 402:
            raise ApiError(
                503, "mentor_no_credits", "The mentor account is out of credit"
            ) from error
        raise ApiError(502, "mentor_failed", "The mentor service did not answer") from error
    except openai.APIConnectionError as error:
        raise ApiError(502, "mentor_failed", "The mentor service did not answer") from error

    choice = response.choices[0] if response.choices else None
    if choice is None or not choice.message.content:
        logger.warning("mentor chat: empty response from DeepSeek")
        raise ApiError(502, "mentor_failed", "The mentor service answered with nothing")
    return choice.message.content
