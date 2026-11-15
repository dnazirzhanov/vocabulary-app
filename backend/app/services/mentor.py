"""Personal Study Mentor chat: answers the learner's questions about their own progress,
plans, and vocabulary, using DeepSeek when a key is configured and a canned reply otherwise."""

from collections.abc import Generator
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.locale import texts_for
from app.core.logging import logger
from app.models import (
    Deck,
    DeckWord,
    MentorMessage,
    ReadingAnswer,
    SpellingProgress,
    User,
    UserWordProgress,
)
from app.services.progress import local_day_bounds
from app.services.promise import promise_of, week_streak
from app.services.reading import library_titles
from app.services.scheduling import local_date
from app.services.study_days import HISTORY_DAYS, days_by_user

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

_SYSTEM = """\
You are a warm, encouraging personal study mentor for a learner studying English vocabulary.
Reply in {LANGUAGE}. Keep replies short and practical — 1 to 4 sentences unless the learner \
explicitly asks for more.
Never invent statistics you don't have.

Current learner state (use this to give personal, relevant advice):
- Name: {NAME}
- Study streak: {STREAK}
- Vocabulary due today: {DUE_VOCAB} words
- Spelling due today: {DUE_SPELLING} words
{DECK_SECTION}{READING_SECTION}\
Help the learner decide what to study, encourage them, and answer questions about their progress.\
"""


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


def _system_prompt(
    user: User,
    streak_weeks: int,
    due_vocab: int,
    due_spelling: int,
    deck_rows: list[tuple[str, int]],
    reading_total: int,
    reading_recent: list[str],
) -> str:
    lang = user.ui_language or "ru"
    t = texts_for(lang)
    streak_text = t.mentor_streak_none if streak_weeks == 0 else t.mentor_streak_weeks(streak_weeks)
    name = user.name or t.mentor_learner_name
    if deck_rows:
        lines = "\n".join(f"  - {title}: {n} words" for title, n in deck_rows)
        deck_section = f"Top decks due today (most due first):\n{lines}\n"
    else:
        deck_section = ""
    if reading_total > 0:
        recent_str = ", ".join(f'"{t}"' for t in reading_recent)
        reading_section = f"Library articles read: {reading_total}"
        if recent_str:
            reading_section += f" (most recent: {recent_str})"
        reading_section += "\n"
    else:
        reading_section = ""
    return (
        _SYSTEM.replace("{LANGUAGE}", _LANGUAGE_NAMES.get(lang, "Russian"))
        .replace("{NAME}", name)
        .replace("{STREAK}", streak_text)
        .replace("{DUE_VOCAB}", str(due_vocab))
        .replace("{DUE_SPELLING}", str(due_spelling))
        .replace("{DECK_SECTION}", deck_section)
        .replace("{READING_SECTION}", reading_section)
    )


def _learner_state(
    db: Session, user: User, now: datetime, time_zone: ZoneInfo
) -> tuple[int, int, int]:
    """(streak_weeks, due_vocab, due_spelling)."""
    today = local_date(now, time_zone)
    since, _ = local_day_bounds(today - timedelta(days=HISTORY_DAYS), time_zone)
    days = days_by_user(db, [user], since, time_zone)[user.id]
    promise = promise_of(db, user)
    streak = week_streak(promise, days, today)

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
    return streak, int(due_vocab), int(due_spelling)


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
    return list(
        db.scalars(
            select(MentorMessage)
            .where(MentorMessage.user_id == user.id)
            .order_by(MentorMessage.created_at.desc())
            .limit(20)
        )
    )[::-1]


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
    streak, due_vocab, due_spelling = _learner_state(db, user, now, time_zone)
    deck_rows = _deck_context(db, user, now)
    reading_total, reading_recent = _reading_context(db, user)
    system = _system_prompt(
        user, streak, due_vocab, due_spelling, deck_rows, reading_total, reading_recent
    )
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
    """Yield text chunks from DeepSeek (or the full demo reply as one chunk), then persist."""

    system, msgs, demo_reply, is_demo = _build_context(db, user, message, settings, now, time_zone)
    if is_demo:
        _persist(db, user, message, demo_reply, now)
        yield demo_reply
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
