"""Personal Study Mentor chat: answers the learner's questions about their own progress,
plans, and vocabulary, using DeepSeek when a key is configured and a canned reply otherwise."""

import dataclasses
import time
from collections.abc import Generator
from datetime import datetime, timedelta
from typing import Any
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
    Word,
)
from app.services.progress import local_day_bounds
from app.services.promise import promise_of, week_streak, weekdays_of
from app.services.reading import library_titles_with_level
from app.services.scheduling import local_date
from app.services.study_days import HISTORY_DAYS, days_by_user, week_of

# How many recent turns are sent as context in each API call.
_HISTORY_TURNS = 10

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
    words_this_week: int = 0
    reviews_this_week: int = 0
    due_vocab: int = 0
    due_spelling: int = 0
    promised_days: str = "none"
    days_this_week: str = "0 days"
    retention: str = "no data yet"
    spelling_accuracy: str = "no data yet"
    reading_accuracy: str = "no data yet"
    last_study: str = "never"
    today_promised: bool = False
    course_level: str | None = None
    deck_rows: list[tuple[str, int, int]] = dataclasses.field(default_factory=list)
    reading_total: int = 0
    reading_library_size: int = 0
    reading_recent: list[str] = dataclasses.field(default_factory=list)
    reading_last: str | None = None
    top_spelling_deck: tuple[str, int] | None = None
    total_decks: int = 0
    studying_since: str = "unknown"
    tip_id: str | None = None
    words_mastered: int = 0
    active_weeks: int = 0
    sample_due_words: list[str] = dataclasses.field(default_factory=list)
    struggling_words: list[str] = dataclasses.field(default_factory=list)


_SYSTEM = """\
You are a warm, encouraging personal study mentor for a learner studying English vocabulary.
Reply in {LANGUAGE}. Keep replies short and practical — 1 to 4 sentences unless the learner \
explicitly asks for more.
Never invent statistics you don't have.

Current learner state (use this to give personal, relevant advice):
- Name: {NAME}
- Local time: {LOCAL_TIME} ({TIME_OF_DAY}, {DAY_OF_WEEK})
- Study streak: {STREAK}
- Sessions completed today: {SESSIONS_TODAY}
- Studying since: {STUDYING_SINCE}
- Last study session: {LAST_STUDY}
- Vocabulary in progress: {WORDS_IN_PROGRESS} words
- Vocabulary recalled at least once: {WORDS_LEARNED} words
- Vocabulary retained long-term (≥21-day interval): {WORDS_MASTERED} words
- New words learned today: {WORDS_TODAY}
- New words learned this week: {WORDS_THIS_WEEK}
- Vocabulary reviews completed this week: {REVIEWS_THIS_WEEK}
- Vocabulary due today: {DUE_VOCAB} words
- Spelling due today: {DUE_SPELLING} words
{SAMPLE_DUE_LINE}{STRUGGLING_LINE}- Promised study days this week: {PROMISED_DAYS}
- Days studied this week: {DAYS_THIS_WEEK}
- Weeks active in last 4 weeks: {ACTIVE_WEEKS}
{PROMISE_LINE}- Vocabulary retention rate (last 7 days): {RETENTION}
- Spelling accuracy (last 7 days): {SPELLING_ACCURACY}
- Reading comprehension accuracy (all time): {READING_ACCURACY}
{PACE_LINE}{LEVEL_LINE}{GOAL_LINE}{TOTAL_DECKS_LINE}{DECK_SECTION}{SPELLING_DECK_LINE}{READING_SECTION}\
{PLAN_SECTION}\
{TIP_LINE}\
{TONE_HINT}\
{URGENCY_HINT}\
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


_TONE_HINTS: dict[str, str] = {
    "firstRun": "Tone: welcoming and simple — the learner is brand new.",
    "newLearner": "Tone: encouraging — first week, build confidence.",
    "returner": "Tone: warm and forward-looking — acknowledge the absence without judgment.",
    "streakMilestone": "Tone: celebratory — a genuine milestone worth marking.",
    "bigBacklog": "Tone: pragmatic and calm — help them prioritize without feeling overwhelmed.",
    "allCaughtUp": "Tone: upbeat — they finished everything, suggest what's next.",
    "streakKeep": "Tone: affirming — acknowledge the active streak and reinforce the habit.",
    "dueInDeck": "Tone: focused — there is a clear deck to tackle; help them commit to it.",
    "spellingAwaits": "Tone: confident — spelling practice builds real fluency; be matter-of-fact.",
    "readingFresh": "Tone: inviting — reading is enrichment; suggest it gently.",
    "default": "Tone: warm and steady — no particular urgency; just consistent encouragement.",
}


def _format_tenure(first_at: datetime, now: datetime) -> str:
    """Human-readable duration since first_at: 'today', 'N days', 'N weeks', 'N months'."""
    days = max(0, (now - first_at).days)
    if days == 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days} days"
    weeks = days // 7
    if weeks < 4:
        return f"{weeks} {'week' if weeks == 1 else 'weeks'}"
    months = days // 30
    return f"{months} {'month' if months == 1 else 'months'}"


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


def _deck_context(db: Session, user: User, now: datetime) -> list[tuple[str, int, int]]:
    """Top 5 decks by due vocab count: (title, due_count, started_count)."""
    n_due = func.count(case((UserWordProgress.due_at <= now, 1), else_=None))
    n_started = func.count(UserWordProgress.word_id)
    rows = db.execute(
        select(Deck.title, n_due.label("n_due"), n_started.label("n_started"))
        .select_from(UserWordProgress)
        .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(UserWordProgress.user_id == user.id)
        .group_by(Deck.id, Deck.title, Deck.level_order)
        .having(n_due >= 1)
        .order_by(n_due.desc(), Deck.level_order)
        .limit(5)
    ).all()
    return [(row.title, int(row.n_due), int(row.n_started)) for row in rows]


def _total_decks(db: Session, user: User) -> int:
    """How many distinct decks this learner has any vocabulary progress in."""
    return (
        db.scalar(
            select(func.count(func.distinct(DeckWord.deck_id)))
            .select_from(UserWordProgress)
            .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
            .where(UserWordProgress.user_id == user.id)
        )
        or 0
    )


def _top_spelling_deck(db: Session, user: User, now: datetime) -> tuple[str, int] | None:
    """The deck with the most spelling words due today, or None if nothing is due."""
    row = db.execute(
        select(Deck.title, func.count(SpellingProgress.word_id).label("n"))
        .select_from(SpellingProgress)
        .join(DeckWord, DeckWord.word_id == SpellingProgress.word_id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(
            SpellingProgress.user_id == user.id,
            SpellingProgress.due_at <= now,
        )
        .group_by(Deck.id, Deck.title)
        .order_by(func.count(SpellingProgress.word_id).desc())
        .limit(1)
    ).first()
    return (row.title, int(row.n)) if row else None


def _reading_context(
    db: Session, user: User, now: datetime, time_zone: ZoneInfo
) -> tuple[int, int, list[str], str | None]:
    """(total_engaged, library_size, recent_titles_newest_first[0:2], last_read_label)."""
    articles = library_titles_with_level()
    library_size = len(articles)
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
        return 0, library_size, [], None
    total = len(rows)
    recent = [
        f"{t} ({lvl})"
        for row in rows[:2]
        if row.reading_ref in articles
        for t, lvl in [articles[row.reading_ref]]
    ]
    today = local_date(now, time_zone)
    last_local = local_date(rows[0].last, time_zone)
    delta = (today - last_local).days
    if delta == 0:
        last_label: str | None = "today"
    elif delta == 1:
        last_label = "yesterday"
    else:
        last_label = f"{delta} days ago"
    return total, library_size, recent, last_label


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


def _mature_words(db: Session, user: User, now: datetime) -> int:
    """Words whose SRS interval is at least 21 days — a proxy for long-term retention."""
    cutoff = now + timedelta(days=21)
    return (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.first_recalled_at.is_not(None),
                UserWordProgress.due_at >= cutoff,
            )
        )
        or 0
    )


def _reading_accuracy(db: Session, user: User) -> str:
    """Accuracy on multiple-choice reading comprehension questions (all time)."""
    row = db.execute(
        select(
            func.count(ReadingAnswer.id).label("total"),
            func.sum(case((ReadingAnswer.correct.is_(True), 1), else_=0)).label("correct"),
        ).where(
            ReadingAnswer.user_id == user.id,
            ReadingAnswer.correct.is_not(None),
        )
    ).first()
    if row and row.total:
        pct = round(100 * (row.correct or 0) / row.total)
        return f"{pct}%"
    return "no data yet"


def _active_weeks(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> int:
    """How many of the last 4 calendar weeks had at least one completed study session."""
    four_weeks_ago = now - timedelta(days=28)
    rows = db.scalars(
        select(LearningSession.completed_at).where(
            LearningSession.user_id == user.id,
            LearningSession.completed_at >= four_weeks_ago,
        )
    ).all()
    iso_weeks = {local_date(ts, time_zone).isocalendar()[:2] for ts in rows if ts is not None}
    return min(4, len(iso_weeks))


def _sample_due_words(db: Session, user: User, now: datetime, n: int = 5) -> list[str]:
    """A handful of the most overdue vocabulary words with their L1 translation."""
    rows = db.execute(
        select(Word.headword, Word.translation)
        .join(UserWordProgress, UserWordProgress.word_id == Word.id)
        .where(
            UserWordProgress.user_id == user.id,
            UserWordProgress.due_at <= now,
        )
        .order_by(UserWordProgress.due_at.asc())
        .limit(n)
    ).all()
    return [f"{row.headword} ({row.translation})" for row in rows]


def _struggling_words(db: Session, user: User, now: datetime, n: int = 3) -> list[str]:
    """Words rated 'again' (rating=1) at least twice in the last 7 days."""
    week_ago = now - timedelta(days=7)
    rows = db.execute(
        select(Word.headword, Word.translation, func.count().label("fails"))
        .join(ReviewAttempt, ReviewAttempt.word_id == Word.id)
        .where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.answered_at >= week_ago,
            ReviewAttempt.rating == 1,
        )
        .group_by(Word.id, Word.headword, Word.translation)
        .having(func.count() >= 2)
        .order_by(func.count().desc())
        .limit(n)
    ).all()
    return [f"{row.headword} ({row.translation})" for row in rows]


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


def _system_prompt(
    user: User,
    now: datetime,
    time_zone: ZoneInfo,
    ctx: LearnerContext,
    plan: list[dict[str, Any]] | None = None,
) -> str:
    lang = user.ui_language or "ru"
    t = texts_for(lang)
    streak_text = (
        t.mentor_streak_none if ctx.streak_weeks == 0 else t.mentor_streak_weeks(ctx.streak_weeks)
    )
    name = user.name or t.mentor_learner_name
    local_dt = now.astimezone(time_zone)
    local_time = local_dt.strftime("%H:%M")
    time_label = _time_of_day(local_dt.hour)
    day_of_week = local_dt.strftime("%A")
    if user.daily_target_words:
        if ctx.words_today > 0:
            pace_line = (
                f"- Daily target: {user.daily_target_words} new words/day"
                f" ({ctx.words_today} completed today)\n"
            )
        else:
            pace_line = f"- Daily target: {user.daily_target_words} new words/day\n"
    else:
        pace_line = ""
    level_line = f"- Current course level: {ctx.course_level}\n" if ctx.course_level else ""
    goal_line = f"- Learning goal: {user.mentor_goal}\n" if user.mentor_goal else ""
    if ctx.deck_rows:
        deck_lines: list[str] = []
        for title, n_due, n_started in ctx.deck_rows:
            if n_started > n_due:
                deck_lines.append(f"  - {title}: {n_due} due / {n_started} in progress")
            else:
                deck_lines.append(f"  - {title}: {n_due} due")
        deck_section = "Top decks due today (most due first):\n" + "\n".join(deck_lines) + "\n"
    else:
        deck_section = ""
    if ctx.total_decks > 0:
        deck_label = "deck" if ctx.total_decks == 1 else "decks"
        total_decks_line = f"- Total vocabulary decks: {ctx.total_decks} {deck_label}\n"
    else:
        total_decks_line = ""
    if plan:
        plan_lines: list[str] = []
        for item in plan:
            kind = item.get("kind", "")
            title = item.get("title", "")
            minutes = item.get("minutes", 0)
            if kind in ("vocab", "spelling"):
                count = item.get("count") or 0
                kind_name = "Vocabulary" if kind == "vocab" else "Spelling"
                plan_lines.append(f'  - {kind_name}: "{title}" — {count} words (~{minutes} min)')
            else:
                level = item.get("level") or ""
                level_part = f" ({level})" if level else ""
                plan_lines.append(f'  - Reading: "{title}"{level_part} — {minutes} min')
        plan_section = "Today's recommended plan:\n" + "\n".join(plan_lines) + "\n"
    elif plan is not None:
        plan_section = "Today's plan: nothing due (all caught up).\n"
    else:
        plan_section = ""
    tip_line = f"Tip shown to learner: {ctx.tip_id}\n" if ctx.tip_id else ""
    tone_hint = _TONE_HINTS[ctx.tip_id] + "\n" if ctx.tip_id in _TONE_HINTS else ""
    if ctx.today_promised:
        studied = ctx.sessions_today != "none"
        promise_line = (
            "- Today is a promised study day — sessions done ✓\n"
            if studied
            else "- Today is a promised study day — not yet studied\n"
        )
    else:
        promise_line = ""
    if ctx.top_spelling_deck:
        spell_title, spell_count = ctx.top_spelling_deck
        word_label = "word" if spell_count == 1 else "words"
        spelling_deck_line = (
            f"Top deck for spelling today: {spell_title} ({spell_count} {word_label})\n"
        )
    else:
        spelling_deck_line = ""
    if ctx.reading_total > 0:
        recent_str = ", ".join(f'"{t}"' for t in ctx.reading_recent)
        if ctx.reading_library_size > 0:
            reading_section = (
                f"Library articles read: {ctx.reading_total} of {ctx.reading_library_size}"
            )
        else:
            reading_section = f"Library articles read: {ctx.reading_total}"
        if recent_str:
            reading_section += f" (most recent: {recent_str})"
        if ctx.reading_last:
            reading_section += f", last read {ctx.reading_last}"
        reading_section += "\n"
    else:
        reading_section = ""
    if ctx.sample_due_words:
        words_str = ", ".join(ctx.sample_due_words)
        sample_due_line = f"- Sample words due today (most overdue first): {words_str}\n"
    else:
        sample_due_line = ""
    if ctx.struggling_words:
        struggling_str = ", ".join(ctx.struggling_words)
        struggling_line = (
            f"- Words the learner has been struggling with this week: {struggling_str}\n"
        )
    else:
        struggling_line = ""
    if ctx.today_promised and ctx.sessions_today == "none" and time_label in ("evening", "night"):
        urgency_hint = (
            f"Note: it is already {time_label} and the learner has not studied today"
            " — this is a promised day.\n"
        )
    else:
        urgency_hint = ""
    return (
        _SYSTEM.replace("{LANGUAGE}", _LANGUAGE_NAMES.get(lang, "Russian"))
        .replace("{NAME}", name)
        .replace("{LOCAL_TIME}", local_time)
        .replace("{TIME_OF_DAY}", time_label)
        .replace("{DAY_OF_WEEK}", day_of_week)
        .replace("{STREAK}", streak_text)
        .replace("{SESSIONS_TODAY}", ctx.sessions_today)
        .replace("{WORDS_IN_PROGRESS}", str(ctx.words_in_progress))
        .replace("{WORDS_LEARNED}", str(ctx.words_learned))
        .replace("{WORDS_MASTERED}", str(ctx.words_mastered))
        .replace("{WORDS_TODAY}", str(ctx.words_today))
        .replace("{WORDS_THIS_WEEK}", str(ctx.words_this_week))
        .replace("{REVIEWS_THIS_WEEK}", str(ctx.reviews_this_week))
        .replace("{DUE_VOCAB}", str(ctx.due_vocab))
        .replace("{DUE_SPELLING}", str(ctx.due_spelling))
        .replace("{SAMPLE_DUE_LINE}", sample_due_line)
        .replace("{STRUGGLING_LINE}", struggling_line)
        .replace("{PROMISED_DAYS}", ctx.promised_days)
        .replace("{DAYS_THIS_WEEK}", ctx.days_this_week)
        .replace("{ACTIVE_WEEKS}", str(ctx.active_weeks))
        .replace("{PROMISE_LINE}", promise_line)
        .replace("{RETENTION}", ctx.retention)
        .replace("{SPELLING_ACCURACY}", ctx.spelling_accuracy)
        .replace("{READING_ACCURACY}", ctx.reading_accuracy)
        .replace("{STUDYING_SINCE}", ctx.studying_since)
        .replace("{LAST_STUDY}", ctx.last_study)
        .replace("{PACE_LINE}", pace_line)
        .replace("{LEVEL_LINE}", level_line)
        .replace("{GOAL_LINE}", goal_line)
        .replace("{TOTAL_DECKS_LINE}", total_decks_line)
        .replace("{DECK_SECTION}", deck_section)
        .replace("{SPELLING_DECK_LINE}", spelling_deck_line)
        .replace("{READING_SECTION}", reading_section)
        .replace("{PLAN_SECTION}", plan_section)
        .replace("{TIP_LINE}", tip_line)
        .replace("{TONE_HINT}", tone_hint)
        .replace("{URGENCY_HINT}", urgency_hint)
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
    today_promised = today.weekday() in promised

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
            hours_ago = int((now - last_at).total_seconds() / 3600)
            if hours_ago == 0:
                last_study_label = "less than an hour ago"
            elif hours_ago == 1:
                last_study_label = "1 hour ago"
            else:
                last_study_label = f"{hours_ago} hours ago"
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
    reviews_this_week = (
        db.scalar(
            select(func.count()).where(
                ReviewAttempt.user_id == user.id,
                ReviewAttempt.answered_at >= week_ago,
                ReviewAttempt.answered_at < now,
                ReviewAttempt.rating.is_not(None),
            )
        )
        or 0
    )

    words_this_week = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.first_recalled_at >= week_ago,
                UserWordProgress.first_recalled_at < now,
            )
        )
        or 0
    )

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

    first_session_at = db.scalar(
        select(func.min(LearningSession.completed_at)).where(LearningSession.user_id == user.id)
    )
    studying_since_str = _format_tenure(first_session_at, now) if first_session_at else "unknown"

    return LearnerContext(
        streak_weeks=streak,
        due_vocab=int(due_vocab),
        due_spelling=int(due_spelling),
        promised_days=promised_days_str,
        days_this_week=days_this_week_str,
        today_promised=today_promised,
        retention=retention_str,
        spelling_accuracy=spelling_accuracy_str,
        last_study=last_study_label,
        words_today=int(words_today),
        words_this_week=int(words_this_week),
        reviews_this_week=int(reviews_this_week),
        studying_since=studying_since_str,
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
    plan: list[dict[str, Any]] | None = None,
    tip_id: str | None = None,
) -> tuple[str, list[dict[str, str]], str, bool]:
    """Return (system_prompt, messages, demo_reply_or_empty, is_demo)."""
    ctx = _learner_state(db, user, now, time_zone)
    words_in_progress, words_learned = _vocab_summary(db, user)
    ctx.words_in_progress = words_in_progress
    ctx.words_learned = words_learned
    ctx.course_level = _course_level(db, user)
    ctx.total_decks = _total_decks(db, user)
    ctx.deck_rows = _deck_context(db, user, now)
    ctx.top_spelling_deck = _top_spelling_deck(db, user, now)
    ctx.reading_total, ctx.reading_library_size, ctx.reading_recent, ctx.reading_last = (
        _reading_context(db, user, now, time_zone)
    )
    ctx.sessions_today = _sessions_today(db, user, now, time_zone)
    ctx.words_mastered = _mature_words(db, user, now)
    ctx.active_weeks = _active_weeks(db, user, now, time_zone)
    ctx.sample_due_words = _sample_due_words(db, user, now)
    ctx.struggling_words = _struggling_words(db, user, now)
    ctx.reading_accuracy = _reading_accuracy(db, user)
    ctx.tip_id = tip_id
    system = _system_prompt(user, now, time_zone, ctx, plan=plan)
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
    plan: list[dict[str, Any]] | None = None,
    tip_id: str | None = None,
) -> str:
    """Send a message to the mentor and return the assistant's reply."""
    system, msgs, demo_reply, is_demo = _build_context(
        db, user, message, settings, now, time_zone, plan=plan, tip_id=tip_id
    )
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
    plan: list[dict[str, Any]] | None = None,
    tip_id: str | None = None,
) -> Generator[str]:
    """Yield text chunks from DeepSeek (or a word-by-word demo reply), then persist."""

    system, msgs, demo_reply, is_demo = _build_context(
        db, user, message, settings, now, time_zone, plan=plan, tip_id=tip_id
    )
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
            max_tokens=settings.mentor_max_tokens,
            temperature=settings.mentor_temperature,
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
            max_tokens=settings.mentor_max_tokens,
            temperature=settings.mentor_temperature,
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
