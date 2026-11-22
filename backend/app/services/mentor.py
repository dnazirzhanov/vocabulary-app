"""Personal Study Mentor chat: answers the learner's questions about their own progress,
plans, and vocabulary, using DeepSeek when a key is configured and a canned reply otherwise."""

import dataclasses
import json
import time
from collections.abc import Generator
from datetime import datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.locale import texts_for
from app.core.logging import logger
from app.models import (
    Deck,
    DeckWord,
    LearningSession,
    MentorConversation,
    MentorMessage,
    ReadingAnswer,
    ReviewAttempt,
    SpellingProgress,
    User,
    UserWordProgress,
    Word,
)
from app.services import dsml, memory, mentor_demo, mentor_events, mentor_tools
from app.services.coach.service import day_type_on, today_blocks
from app.services.progress import local_day_bounds
from app.services.promise import promise_of, week_streak, weekdays_of
from app.services.reading import library_titles_with_level
from app.services.scheduling import local_date
from app.services.study_days import HISTORY_DAYS, days_by_user, week_of
from app.services.today_log import lines as today_lines
from app.services.today_log import practice_today

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
    # Today's practice, line by line, from the app's records (what was done, when, finished).
    practice_log: str = ""
    practiced_today: bool = False
    words_in_progress: int = 0
    words_learned: int = 0
    words_today: int = 0
    words_this_week: int = 0
    words_last_week: int = 0
    sessions_this_week: int = 0
    reviews_this_week: int = 0
    due_vocab: int = 0
    due_vocab_overdue: int = 0
    due_spelling: int = 0
    vocab_upcoming_3days: int = 0
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
    last_studied_deck: str | None = None
    top_struggle_deck: tuple[str, int] | None = None
    top_spelling_deck: tuple[str, int] | None = None
    total_decks: int = 0
    studying_since: str = "unknown"
    tip_id: str | None = None
    words_mastered: int = 0
    words_nearly_mastered: int = 0
    active_weeks: int = 0
    days_studied_month: int = 0
    sample_due_words: list[str] = dataclasses.field(default_factory=list)
    struggling_words: list[str] = dataclasses.field(default_factory=list)
    reading_level_counts: dict[str, tuple[int, int]] = dataclasses.field(default_factory=dict)
    # Today's recurring events in local-clock order: (title, kind, start_minute, end_minute).
    schedule_today: list[tuple[str, str, int, int]] = dataclasses.field(default_factory=list)
    # What kind of day the learner said today is (ADR 0076).
    day_type: str | None = None


_SYSTEM = """\
It is now {DAY_OF_WEEK}, {LOCAL_DATE}, {LOCAL_TIME} ({TIME_OF_DAY}) in the learner's own time \
zone ({TIME_ZONE}). The learner's earlier messages are marked with when they were sent, like \
[Mon 08:15]; any time or part of the day mentioned in earlier messages is out of date. Always \
use this time, and never write such [marks] yourself.

You are a warm, honest personal English mentor. You help the learner set a concrete goal, break \
it into small daily activities, find the best time and amount of time to study, keep that \
promise, and adjust it when it doesn't work. Reply in {LANGUAGE}.
Tools (use them; never invent tasks, times or numbers a tool did not give you):
- When the learner asks what to do (now, next, today) or seems unsure, call what_now and give \
one clear recommendation. The app shows a «Start now» button under it: don't explain how to start.
- To offer a particular kind of practice (words, spelling, reading, writing, speaking), call \
suggest_activity.
- For their goal, help make it concrete (what for, target level or IELTS band, by when, why), \
then call propose_goal. If it is out of reach in their time, say so kindly and offer the two \
choices it gives: more minutes a day, or a later date.
- The calendar is yours to change. Whenever they say what their week is or how it changed \
(school, work, sport, sleep...), call set_schedule at once: it saves, and they can undo it. Never \
ask them to confirm first, never say the app adds a block by itself, and never say you can't add \
something. To change or remove a block, use its existing title. Then offer to find a study time \
with propose_study_times. Small and fixed beats big and vague: suggest 10–20 minutes unless \
they want more.
- When one date is different (no school tomorrow, a concert on Saturday), call change_day at \
once; for illness or a trip offer a pause with propose_exception, so no promised day counts as \
missed.
- After a calendar change, say in one sentence what changed. A goal, a study time, a pause, a \
reminder or a fact is saved only when they tap it: say so in a few words.
- When they ask what their schedule or calendar is, or how today (or another day) looks, call \
show with component day (and date for another day): never list it in text or call what_now \
for it.
- For their goal's progress this week, call get_week_plan.
- If they missed yesterday, say kindly that today matters most and that 5 minutes counts \
(never miss twice); don't scold.
- End most answers by calling offer_replies with 2–4 short replies they might tap.
- When the learner tells you something lasting about themselves (why they learn, what they \
like or dislike, what limits their time, when they have energy, their own words for things), \
call remember with one short fact in their language; it is saved only if they tap. Don't \
remember passing moods or anything private that a family or teacher should not see.
- Before answering about something they told you before, call recall.
- For statistics (words in progress, learned or mastered, this and last week's numbers, \
retention and accuracy, decks, reading, how long and how regularly they study), call get_stats; \
never guess them.
- Everything in the app can be looked up (ADR 0079): other days' practice (get_practice), \
their words (get_words), essays and feedback (get_writing), speaking results (get_speaking), \
reading (get_reading), group decks and deadlines (get_assignments), a date's plan \
(get_calendar), a week's or month's progress (get_progress). Look it up before you answer, \
and never say you don't know or can't see something before you have. Reminders: \
propose_reminders.
- Whether they did something today: answer from «Practice today so far» below, exactly: what, \
when, how long, finished or not. It is complete, so never say you have no data about today; \
if something isn't listed, it wasn't done in the app today. An unfinished lesson can be \
continued where it stopped.
- Use show to put one interactive component on screen instead of describing it: day when \
they ask about their schedule or where something fits; words for a quick warm-up; day_check when \
the plan seems too much (tired, sick, an exam); choice whenever you ask a question with a few \
likely answers; celebrate when they did well. At most one show per answer; say in one \
sentence what it shows, never repeat its contents.
- Blocks of kind rest, play and sleep are protected: never put study there, and if the learner \
wants to give them up to study more, gently defend them (rest helps memory; sleep most of all).
- Follow today's kind of day (below, if said): a light day asks about half, an exam day only 5 \
minutes, a sick day nothing (wish them well; don't suggest studying).
Formatting rules (follow these strictly):
- Keep replies short: 1–3 sentences for simple questions, or a compact bullet list (3–5 items max).
- Use markdown: **bold** for key terms, bullet lists (- ) when listing steps or options, \
> blockquote for a single important takeaway.
- Never write long paragraphs. If the answer has more than one idea, use bullets.
- Never invent statistics you don't have.
When the learner asks what to do now, use the current local time and today's schedule \
(below, if present): recommend activities that fit the current free gap. Do not suggest \
studying during a scheduled block.
App activities the learner can do: vocabulary flashcards (spaced repetition), \
spelling practice, reading library articles (comprehension questions included).

Current learner state (use this to give personal, relevant advice):
- Name: {NAME}
- Local date and time: {LOCAL_DATE} {LOCAL_TIME} ({TIME_OF_DAY}, {DAY_OF_WEEK})
- Study streak: {STREAK}
- Sessions completed today: {SESSIONS_TODAY}
- Vocabulary due today: {DUE_VOCAB} words{OVERDUE_VOCAB_PART}
- Spelling due today: {DUE_SPELLING} words
- Promised study days this week: {PROMISED_DAYS}
- Days studied this week: {DAYS_THIS_WEEK}
{PROMISE_LINE}{PACE_LINE}{LEVEL_LINE}{GOAL_LINE}{BUDGET_LINE}{SCHEDULE_SECTION}{LAST_STUDIED_DECK_LINE}\
{PLAN_SECTION}\
{TIP_LINE}\
{TONE_HINT}\
{URGENCY_HINT}\
Help the learner decide what to study, encourage them, and answer questions about their progress.\
"""


# The rest of what used to be in every prompt (ADR 0079): fetched with get_stats when needed.
_STATS = """\
The learner's statistics (from get_stats):
- Studying since: {STUDYING_SINCE}
- Last study session: {LAST_STUDY}
- Vocabulary in progress: {WORDS_IN_PROGRESS} words
- Vocabulary recalled at least once: {WORDS_LEARNED} words
- Vocabulary retained long-term (≥21-day interval): {WORDS_MASTERED} words
- Vocabulary nearly mastered (14–21-day interval): {WORDS_NEARLY_MASTERED} words
- New words learned this week: {WORDS_THIS_WEEK}
- New words learned last week: {WORDS_LAST_WEEK}
- Study sessions completed this week: {SESSIONS_THIS_WEEK}
- Vocabulary reviews completed this week: {REVIEWS_THIS_WEEK}
- Vocabulary due in next 3 days: {VOCAB_UPCOMING_3DAYS} words
- Weeks active in last 4 weeks: {ACTIVE_WEEKS}
- Days studied in last 30 days: {DAYS_STUDIED_MONTH}
- Vocabulary retention rate (last 7 days): {RETENTION}
- Spelling accuracy (last 7 days): {SPELLING_ACCURACY}
- Reading comprehension accuracy (all time): {READING_ACCURACY}
- New words learned today: {WORDS_TODAY}
{SAMPLE_DUE_LINE}{STRUGGLING_LINE}{TOTAL_DECKS_LINE}{DECK_SECTION}{SPELLING_DECK_LINE}{STRUGGLE_DECK_LINE}{READING_SECTION}{READING_LEVEL_LINE}"""


def _time_of_day(hour: int) -> str:
    """'morning' / 'afternoon' / 'evening' / 'night' for a local hour (0–23)."""
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 21:
        return "evening"
    return "night"


def _fmt_minute(m: int) -> str:
    """Minutes-from-midnight → 'HH:MM' (24h)."""
    return f"{m // 60:02d}:{m % 60:02d}"


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


def _top_vocab_struggle_deck(db: Session, user: User, now: datetime) -> tuple[str, int] | None:
    """The deck with the most 'again' (rating=1) reviews in the last 7 days, or None."""
    week_ago = now - timedelta(days=7)
    row = db.execute(
        select(Deck.title, func.count().label("n_fails"))
        .select_from(ReviewAttempt)
        .join(Word, Word.id == ReviewAttempt.word_id)
        .join(DeckWord, DeckWord.word_id == Word.id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.answered_at >= week_ago,
            ReviewAttempt.rating == 1,
        )
        .group_by(Deck.id, Deck.title)
        .order_by(func.count().desc())
        .limit(1)
    ).first()
    return (row.title, int(row.n_fails)) if row else None


def _last_studied_deck(db: Session, user: User) -> str | None:
    """Title of the most recently completed study/spelling session's deck, or None."""
    row = db.execute(
        select(Deck.title)
        .select_from(LearningSession)
        .join(Deck, Deck.id == LearningSession.deck_id)
        .where(
            LearningSession.user_id == user.id,
            LearningSession.completed_at.is_not(None),
            LearningSession.kind.in_(["study", "hard", "spelling"]),
        )
        .order_by(LearningSession.completed_at.desc())
        .limit(1)
    ).first()
    return row[0] if row else None


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


def _nearly_mastered_words(db: Session, user: User, now: datetime) -> int:
    """Words with a 14–21-day SRS interval: one good review away from long-term mastery."""
    low = now + timedelta(days=14)
    high = now + timedelta(days=21)
    return (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.first_recalled_at.is_not(None),
                UserWordProgress.due_at >= low,
                UserWordProgress.due_at < high,
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


def _reading_level_breakdown(db: Session, user: User) -> dict[str, tuple[int, int]]:
    """For each level in the library, return (articles_read, articles_available)."""
    articles = library_titles_with_level()
    available: dict[str, int] = {}
    for _ref, (_title, level) in articles.items():
        available[level] = available.get(level, 0) + 1
    if not available:
        return {}
    read_refs = set(
        db.scalars(
            select(ReadingAnswer.reading_ref)
            .distinct()
            .where(
                ReadingAnswer.user_id == user.id,
                ReadingAnswer.reading_ref.like("library:%"),
            )
        ).all()
    )
    read_by_level: dict[str, int] = {}
    for ref, (_title, level) in articles.items():
        if ref in read_refs:
            read_by_level[level] = read_by_level.get(level, 0) + 1
    level_order = ["A1", "A2", "B1", "B2", "C1"]
    return {
        lvl: (read_by_level.get(lvl, 0), available[lvl]) for lvl in level_order if lvl in available
    }


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


DAY_TYPE_LINES = {
    "study": "ordinary study day: the usual plan.",
    "light": "light day: about half the usual plan, the most important first.",
    "weekend": "day off: the usual plan, at any free time.",
    "sick": "sick day: nothing is asked and nothing counts as missed.",
    "exam": "exam day: only the 5-minute minimum.",
}


def _schedule_today(
    db: Session, user: User, now: datetime, time_zone: ZoneInfo
) -> list[tuple[str, str, int, int]]:
    """Today's blocks, sorted by start (ADR 0074): skips taken off, one-offs on their date."""
    return today_blocks(db, user, local_date(now, time_zone))


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
    template: str | None = None,
) -> str:
    lang = user.ui_language or "ru"
    t = texts_for(lang)
    streak_text = (
        t.mentor_streak_none if ctx.streak_weeks == 0 else t.mentor_streak_weeks(ctx.streak_weeks)
    )
    name = user.name or t.mentor_learner_name
    local_dt = now.astimezone(time_zone)
    local_date_str = local_dt.strftime("%Y-%m-%d")
    local_time = local_dt.strftime("%H:%M")
    time_label = _time_of_day(local_dt.hour)
    day_of_week = local_dt.strftime("%A")
    if user.daily_target_words:
        target = user.daily_target_words
        if ctx.words_today >= target:
            if ctx.words_today == target:
                status = " — target reached ✓"
            else:
                status = f" — exceeded ({ctx.words_today - target} bonus)"
            pace_line = (
                f"- Daily target: {target} new words/day ({ctx.words_today} today{status})\n"
            )
        elif ctx.words_today > 0:
            remaining = target - ctx.words_today
            pace_line = (
                f"- Daily target: {target} new words/day"
                f" ({ctx.words_today} today, {remaining} remaining)\n"
            )
        else:
            pace_line = f"- Daily target: {target} new words/day (none yet today)\n"
    else:
        pace_line = ""
    level_line = f"- Current course level: {ctx.course_level}\n" if ctx.course_level else ""
    goal_line = f"- Learning goal: {user.mentor_goal}\n" if user.mentor_goal else ""
    budget_line = (
        f"- Daily study budget: {user.mentor_daily_minutes} minutes\n"
        if user.mentor_daily_minutes
        else ""
    )
    if ctx.schedule_today:
        schedule_lines = [
            f"  - {_fmt_minute(start)}–{_fmt_minute(end)} {title} ({kind})"
            for title, kind, start, end in ctx.schedule_today
        ]
        schedule_section = "Today's schedule (local time):\n" + "\n".join(schedule_lines) + "\n"
    else:
        schedule_section = ""
    if ctx.day_type in DAY_TYPE_LINES:
        schedule_section += f"Today: {DAY_TYPE_LINES[ctx.day_type]}\n"
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
    last_studied_deck_line = (
        f"- Last studied deck: {ctx.last_studied_deck}\n" if ctx.last_studied_deck else ""
    )
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
            elif kind == "reading":
                level = item.get("level") or ""
                level_part = f" ({level})" if level else ""
                plan_lines.append(f'  - Reading: "{title}"{level_part} — {minutes} min')
            else:
                plan_lines.append(f"  - {str(kind).capitalize()}: {minutes} min")
        plan_section = (
            "Today's recommended plan, still to do (tasks already done are no longer in it):\n"
            + "\n".join(plan_lines)
            + "\n"
        )
    elif plan is not None:
        plan_section = "Today's plan: nothing left to do (all done or nothing due).\n"
    else:
        plan_section = ""
    plan_section = ctx.practice_log + plan_section
    tip_line = f"Tip shown to learner: {ctx.tip_id}\n" if ctx.tip_id else ""
    tone_hint = _TONE_HINTS[ctx.tip_id] + "\n" if ctx.tip_id in _TONE_HINTS else ""
    if ctx.today_promised:
        studied = ctx.practiced_today or ctx.sessions_today != "none"
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
    if ctx.top_struggle_deck:
        struggle_title, struggle_count = ctx.top_struggle_deck
        fail_label = "time" if struggle_count == 1 else "times"
        struggle_deck_line = (
            f"Deck with most 'again' this week: {struggle_title} ({struggle_count} {fail_label})\n"
        )
    else:
        struggle_deck_line = ""
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
    if ctx.reading_level_counts:
        parts = [f"{lvl} {r}/{a}" for lvl, (r, a) in ctx.reading_level_counts.items()]
        reading_level_line = f"Reading library by level (read/available): {', '.join(parts)}\n"
    else:
        reading_level_line = ""
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
    if (
        ctx.today_promised
        and not ctx.practiced_today
        and ctx.sessions_today == "none"
        and time_label in ("evening", "night")
    ):
        urgency_hint = (
            f"Note: it is already {time_label} and the learner has not studied today"
            " — this is a promised day.\n"
        )
    else:
        urgency_hint = ""
    return (
        (template or _SYSTEM)
        .replace("{LANGUAGE}", _LANGUAGE_NAMES.get(lang, "Russian"))
        .replace("{NAME}", name)
        .replace("{LOCAL_DATE}", local_date_str)
        .replace("{LOCAL_TIME}", local_time)
        .replace("{TIME_OF_DAY}", time_label)
        .replace("{DAY_OF_WEEK}", day_of_week)
        .replace("{TIME_ZONE}", time_zone.key)
        .replace("{STREAK}", streak_text)
        .replace("{SESSIONS_TODAY}", ctx.sessions_today)
        .replace("{WORDS_IN_PROGRESS}", str(ctx.words_in_progress))
        .replace("{WORDS_LEARNED}", str(ctx.words_learned))
        .replace("{WORDS_MASTERED}", str(ctx.words_mastered))
        .replace("{WORDS_NEARLY_MASTERED}", str(ctx.words_nearly_mastered))
        .replace("{WORDS_TODAY}", str(ctx.words_today))
        .replace("{WORDS_THIS_WEEK}", str(ctx.words_this_week))
        .replace("{WORDS_LAST_WEEK}", str(ctx.words_last_week))
        .replace("{SESSIONS_THIS_WEEK}", str(ctx.sessions_this_week))
        .replace("{REVIEWS_THIS_WEEK}", str(ctx.reviews_this_week))
        .replace("{DUE_VOCAB}", str(ctx.due_vocab))
        .replace(
            "{OVERDUE_VOCAB_PART}",
            f" ({ctx.due_vocab_overdue} overdue >7 days)" if ctx.due_vocab_overdue > 0 else "",
        )
        .replace("{VOCAB_UPCOMING_3DAYS}", str(ctx.vocab_upcoming_3days))
        .replace("{DUE_SPELLING}", str(ctx.due_spelling))
        .replace("{SAMPLE_DUE_LINE}", sample_due_line)
        .replace("{STRUGGLING_LINE}", struggling_line)
        .replace("{PROMISED_DAYS}", ctx.promised_days)
        .replace("{DAYS_THIS_WEEK}", ctx.days_this_week)
        .replace("{ACTIVE_WEEKS}", str(ctx.active_weeks))
        .replace("{DAYS_STUDIED_MONTH}", str(ctx.days_studied_month))
        .replace("{PROMISE_LINE}", promise_line)
        .replace("{RETENTION}", ctx.retention)
        .replace("{SPELLING_ACCURACY}", ctx.spelling_accuracy)
        .replace("{READING_ACCURACY}", ctx.reading_accuracy)
        .replace("{STUDYING_SINCE}", ctx.studying_since)
        .replace("{LAST_STUDY}", ctx.last_study)
        .replace("{PACE_LINE}", pace_line)
        .replace("{LEVEL_LINE}", level_line)
        .replace("{GOAL_LINE}", goal_line)
        .replace("{BUDGET_LINE}", budget_line)
        .replace("{SCHEDULE_SECTION}", schedule_section)
        .replace("{TOTAL_DECKS_LINE}", total_decks_line)
        .replace("{LAST_STUDIED_DECK_LINE}", last_studied_deck_line)
        .replace("{DECK_SECTION}", deck_section)
        .replace("{SPELLING_DECK_LINE}", spelling_deck_line)
        .replace("{STRUGGLE_DECK_LINE}", struggle_deck_line)
        .replace("{READING_SECTION}", reading_section)
        .replace("{READING_LEVEL_LINE}", reading_level_line)
        .replace("{PLAN_SECTION}", plan_section)
        .replace("{TIP_LINE}", tip_line)
        .replace("{TONE_HINT}", tone_hint)
        .replace("{URGENCY_HINT}", urgency_hint)
    )


def _stats_text(user: User, now: datetime, time_zone: ZoneInfo, ctx: LearnerContext) -> str:
    """The statistics no longer in every prompt, worded as they were (ADR 0079)."""
    return _system_prompt(user, now, time_zone, ctx, template=_STATS)


def learner_context(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> LearnerContext:
    """Everything the mentor is told about a learner, from the database."""
    ctx = _learner_state(db, user, now, time_zone)
    _fill_context(db, user, now, time_zone, ctx)
    return ctx


def stats_for(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> str:
    return _stats_text(user, now, time_zone, learner_context(db, user, now, time_zone))


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

    month_ago = today - timedelta(days=30)
    days_studied_month = sum(
        1 for d, s in days.items() if d > month_ago and d <= today and s.studied
    )

    due_vocab = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.due_at <= now,
            )
        )
        or 0
    )
    week_old = now - timedelta(days=7)
    due_vocab_overdue = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.due_at <= week_old,
            )
        )
        or 0
    )
    three_days_ahead = now + timedelta(days=3)
    vocab_upcoming_3days = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.due_at > now,
                UserWordProgress.due_at <= three_days_ahead,
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

    two_weeks_ago = now - timedelta(days=14)
    words_last_week = (
        db.scalar(
            select(func.count()).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.first_recalled_at >= two_weeks_ago,
                UserWordProgress.first_recalled_at < week_ago,
            )
        )
        or 0
    )

    week_start, _ = local_day_bounds(week_of(today)[0], time_zone)
    sessions_this_week = (
        db.scalar(
            select(func.count()).where(
                LearningSession.user_id == user.id,
                LearningSession.completed_at >= week_start,
                LearningSession.completed_at < now,
                LearningSession.kind.in_(["study", "hard"]),
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
        due_vocab_overdue=int(due_vocab_overdue),
        vocab_upcoming_3days=int(vocab_upcoming_3days),
        due_spelling=int(due_spelling),
        promised_days=promised_days_str,
        days_this_week=days_this_week_str,
        days_studied_month=days_studied_month,
        today_promised=today_promised,
        retention=retention_str,
        spelling_accuracy=spelling_accuracy_str,
        last_study=last_study_label,
        words_today=int(words_today),
        words_this_week=int(words_this_week),
        words_last_week=int(words_last_week),
        sessions_this_week=int(sessions_this_week),
        reviews_this_week=int(reviews_this_week),
        studying_since=studying_since_str,
    )


# --- conversations (ADR 0072) ----------------------------------------------------------------

TITLE_CHARS = 60
CONVERSATIONS_LISTED = 100


def title_of(message: str) -> str:
    """A chat's name from its first question: one line, cut at a word."""
    flat = " ".join(message.split())
    if len(flat) <= TITLE_CHARS:
        return flat or "…"
    return (flat[:TITLE_CHARS].rsplit(" ", 1)[0] or flat[:TITLE_CHARS]) + "…"


def conversations(db: Session, user: User) -> list[MentorConversation]:
    return list(
        db.scalars(
            select(MentorConversation)
            .where(MentorConversation.user_id == user.id)
            .order_by(MentorConversation.updated_at.desc(), MentorConversation.created_at.desc())
            .limit(CONVERSATIONS_LISTED)
        )
    )


def conversation_of(db: Session, user: User, conversation_id: Any) -> MentorConversation:
    found = db.scalar(
        select(MentorConversation).where(
            MentorConversation.id == conversation_id, MentorConversation.user_id == user.id
        )
    )
    if found is None:
        raise ApiError(404, "conversation_not_found", "No such conversation")
    return found


def new_conversation(db: Session, user: User, title: str, now: datetime) -> MentorConversation:
    conversation = MentorConversation(
        user_id=user.id, title=title_of(title), created_at=now, updated_at=now
    )
    db.add(conversation)
    db.commit()
    return conversation


def resolve_conversation(
    db: Session, user: User, conversation_id: Any, new: bool, message: str, now: datetime
) -> MentorConversation:
    """The chat a message goes to: the one named (the learner's own), a new one, or (the app
    before chats) the latest."""
    if conversation_id is not None:
        return conversation_of(db, user, conversation_id)
    if new:
        return new_conversation(db, user, message, now)
    return latest_conversation(db, user) or new_conversation(db, user, message, now)


def latest_conversation(db: Session, user: User) -> MentorConversation | None:
    return db.scalar(
        select(MentorConversation)
        .where(MentorConversation.user_id == user.id)
        .order_by(MentorConversation.updated_at.desc())
        .limit(1)
    )


def messages_of(db: Session, conversation: MentorConversation) -> list[MentorMessage]:
    """A chat's messages in order, without a question whose answer never came (a stream that
    failed before it was saved)."""
    msgs = list(
        db.scalars(
            select(MentorMessage)
            .where(MentorMessage.conversation_id == conversation.id)
            .order_by(MentorMessage.created_at)
        )
    )
    if msgs and msgs[-1].role == "user":
        msgs = msgs[:-1]
    return msgs


def _recent_history(db: Session, conversation: MentorConversation | None) -> list[MentorMessage]:
    if conversation is None:
        return []
    return list(
        db.scalars(
            select(MentorMessage)
            .where(MentorMessage.conversation_id == conversation.id)
            .order_by(MentorMessage.created_at.desc())
            .limit(_HISTORY_TURNS * 2)
        )
    )[::-1]


def _dated(message: MentorMessage, zone: ZoneInfo) -> str:
    """A past question as the model sees it: marked with when it was asked, so that a time it
    mentions reads as then, not now."""
    if message.role != "user":
        return message.content
    local = message.created_at.astimezone(zone)
    return f"[{local:%a %H:%M}] {message.content}"


def history(db: Session, user: User) -> list[MentorMessage]:
    """The latest chat's last 20 messages (the app before chats shows one conversation)."""
    conversation = latest_conversation(db, user)
    return messages_of(db, conversation)[-20:] if conversation else []


def clear_history(db: Session, user: User) -> None:
    """Delete every chat and message of this user."""
    from sqlalchemy import delete

    db.execute(delete(MentorMessage).where(MentorMessage.user_id == user.id))
    db.execute(delete(MentorConversation).where(MentorConversation.user_id == user.id))
    db.commit()


def _persist(
    db: Session,
    user: User,
    user_text: str,
    assistant_text: str,
    now: datetime,
    conversation: MentorConversation | None = None,
    parts: list[dict[str, Any]] | None = None,
) -> None:
    if conversation is None:
        conversation = latest_conversation(db, user) or new_conversation(db, user, user_text, now)
    db.add(
        MentorMessage(
            user_id=user.id,
            role="user",
            content=user_text,
            created_at=now,
            conversation_id=conversation.id,
        )
    )
    # +1 µs so the assistant message always sorts after the user message even when both are saved
    # with the same clock reading (which happens in tests and can happen in fast demo mode).
    db.add(
        MentorMessage(
            user_id=user.id,
            role="assistant",
            content=assistant_text,
            created_at=now + timedelta(microseconds=1),
            conversation_id=conversation.id,
            parts=parts or None,
        )
    )
    conversation.updated_at = now
    db.commit()


def _fill_context(
    db: Session, user: User, now: datetime, time_zone: ZoneInfo, ctx: LearnerContext
) -> None:
    words_in_progress, words_learned = _vocab_summary(db, user)
    ctx.words_in_progress = words_in_progress
    ctx.words_learned = words_learned
    ctx.course_level = _course_level(db, user)
    ctx.total_decks = _total_decks(db, user)
    ctx.deck_rows = _deck_context(db, user, now)
    ctx.top_spelling_deck = _top_spelling_deck(db, user, now)
    ctx.top_struggle_deck = _top_vocab_struggle_deck(db, user, now)
    ctx.last_studied_deck = _last_studied_deck(db, user)
    ctx.reading_total, ctx.reading_library_size, ctx.reading_recent, ctx.reading_last = (
        _reading_context(db, user, now, time_zone)
    )
    ctx.sessions_today = _sessions_today(db, user, now, time_zone)
    log = practice_today(db, user, now, time_zone)
    ctx.practice_log = today_lines(log)
    ctx.practiced_today = any(p.finished for p in log)
    ctx.words_mastered = _mature_words(db, user, now)
    ctx.words_nearly_mastered = _nearly_mastered_words(db, user, now)
    ctx.active_weeks = _active_weeks(db, user, now, time_zone)
    ctx.sample_due_words = _sample_due_words(db, user, now)
    ctx.struggling_words = _struggling_words(db, user, now)
    ctx.reading_accuracy = _reading_accuracy(db, user)
    ctx.reading_level_counts = _reading_level_breakdown(db, user)
    ctx.schedule_today = _schedule_today(db, user, now, time_zone)
    ctx.day_type = day_type_on(db, user, local_date(now, time_zone))


def _build_context(
    db: Session,
    user: User,
    message: str,
    settings: Settings,
    now: datetime,
    time_zone: ZoneInfo,
    plan: list[dict[str, Any]] | None = None,
    tip_id: str | None = None,
    conversation: MentorConversation | None = None,
) -> tuple[str, list[dict[str, str]], str, bool]:
    """Return (system_prompt, messages, demo_reply_or_empty, is_demo)."""
    ctx = learner_context(db, user, now, time_zone)
    ctx.tip_id = tip_id
    system = _system_prompt(user, now, time_zone, ctx, plan=plan)
    # What the mentor remembers (ADR 0075): facts, the plan's story, earlier chats.
    known = memory.block(db, user, time_zone, conversation)
    if known:
        system = f"{system}\n\n{known}"
    history = _recent_history(db, conversation)
    demo = settings.mentor_chat_demo or (
        not settings.deepseek_api_key and settings.environment != "production"
    )
    if demo:
        return system, [], texts_for(user.ui_language).mentor_demo_reply, True
    if not settings.deepseek_api_key:
        raise ApiError(503, "mentor_unavailable", "The mentor service is not configured")
    msgs: list[dict[str, str]] = [
        {"role": m.role, "content": _dated(m, time_zone)} for m in history
    ]
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
    """Send a message to the mentor and return the reply: the app before chats, continuing its
    latest conversation, without tools."""
    conversation = latest_conversation(db, user)
    system, msgs, demo_reply, is_demo = _build_context(
        db,
        user,
        message,
        settings,
        now,
        time_zone,
        plan=plan,
        tip_id=tip_id,
        conversation=conversation,
    )
    if is_demo:
        _persist(db, user, message, demo_reply, now, conversation)
        return demo_reply
    reply = _call_deepseek(system, msgs, settings)
    _persist(db, user, message, reply, now, conversation)
    return reply


# At most this many rounds of tool calls before the mentor must answer.
MAX_TOOL_ROUNDS = 4  # a lookup, then often a component, then the answer (ADR 0079)


def stream_chat(
    db: Session,
    user: User,
    message: str,
    settings: Settings,
    now: datetime,
    time_zone: ZoneInfo,
    plan: list[dict[str, Any]] | None = None,
    tip_id: str | None = None,
    conversation: MentorConversation | None = None,
) -> Generator[dict[str, Any]]:
    """The mentor's answer as events (ADR 0072): the chat it went to, then tool steps and text as
    they happen; then everything is saved with the chat. `conversation` comes from
    `resolve_conversation`, before the stream starts, so a wrong id is a 404 and not a broken
    stream."""
    if conversation is None:
        conversation = resolve_conversation(db, user, None, False, message, now)
    yield {"conversation": {"id": str(conversation.id), "title": conversation.title}}

    system, msgs, demo_reply, is_demo = _build_context(
        db,
        user,
        message,
        settings,
        now,
        time_zone,
        plan=plan,
        tip_id=tip_id,
        conversation=conversation,
    )
    ctx = mentor_tools.ToolContext(db, user, now, time_zone, plan or [])
    parts: list[dict[str, Any]] = []
    clock = _Clock()
    if is_demo:
        for name, args in mentor_demo.tools_for(message):
            yield from _run_tool(ctx, name, args, f"demo-{len(parts)}", parts)
        delay = settings.mentor_demo_stream_delay_ms / 1000
        words = demo_reply.split(" ")
        for i, word in enumerate(words):
            if delay > 0:
                time.sleep(delay)
            clock.saw()
            yield {"delta": word if i == len(words) - 1 else word + " "}
        _persist(db, user, message, demo_reply, now, conversation, parts)
        _measure(db, user, now, clock, ctx, parts, demo=True)
        return
    text: list[str] = []
    for event in _stream_with_tools(system, msgs, settings, ctx, parts):
        if "delta" in event:
            text.append(event["delta"])
        clock.saw()
        yield event
    _persist(db, user, message, "".join(text) or " ", now, conversation, parts)
    _measure(db, user, now, clock, ctx, parts, demo=False)


class _Clock:
    """Wall time of one answer: to its first visible piece, and to its end."""

    def __init__(self) -> None:
        self.start = time.monotonic()
        self.first: float | None = None

    def saw(self) -> None:
        if self.first is None:
            self.first = time.monotonic()


def _measure(
    db: Session,
    user: User,
    now: datetime,
    clock: _Clock,
    ctx: mentor_tools.ToolContext,
    parts: list[dict[str, Any]],
    *,
    demo: bool,
) -> None:
    """One answer's timing and token use (ADR 0078), logged and kept for the weekly metrics."""
    end = time.monotonic()
    props: dict[str, Any] = {
        "first_ms": round(((clock.first or end) - clock.start) * 1000),
        "total_ms": round((end - clock.start) * 1000),
        "tools": [p["name"] for p in parts],
        "demo": demo,
        **ctx.stats,
    }
    logger.info("mentor answer %s", json.dumps(props))
    try:
        mentor_events.record(db, user, "chat_message", props, now)
    except SQLAlchemyError:
        db.rollback()
        logger.warning("mentor answer not recorded")


def _run_tool(
    ctx: mentor_tools.ToolContext,
    name: str,
    args: dict[str, Any],
    call_id: str,
    parts: list[dict[str, Any]],
) -> Generator[dict[str, Any], None, dict[str, Any]]:
    """One tool step: shown as running, run, then shown done with its card. Returns what the
    model is told."""
    yield {"tool": {"id": call_id, "name": name, "status": "running"}}
    outcome = mentor_tools.run(name, ctx, args)
    card = outcome.card
    # The same activity twice in one answer (what_now, then suggest_activity) shows once.
    if card and card.get("type") == "activity":
        same = (card.get("kind"), card.get("deck_id"), card.get("article_id"))
        if any(
            (p["card"] or {}).get("type") == "activity"
            and (
                (p["card"] or {}).get("kind"),
                p["card"].get("deck_id"),
                p["card"].get("article_id"),
            )
            == same
            for p in parts
        ):
            card = None
    parts.append({"type": "tool", "name": name, "card": card})
    yield {"tool": {"id": call_id, "name": name, "status": "done", "card": card}}
    return outcome.result


def _count_usage(stats: dict[str, int], usage: Any) -> None:
    """Adds one round's tokens: prompt, answer, and how much of the prompt the cache served
    (DeepSeek: prompt_cache_hit_tokens; the OpenAI form: prompt_tokens_details.cached_tokens)."""
    details = getattr(usage, "prompt_tokens_details", None)
    cached = getattr(usage, "prompt_cache_hit_tokens", None) or getattr(details, "cached_tokens", 0)
    for key, value in (
        ("prompt_tokens", usage.prompt_tokens),
        ("completion_tokens", usage.completion_tokens),
        ("cached_tokens", cached or 0),
    ):
        stats[key] = stats.get(key, 0) + int(value or 0)
    stats["rounds"] = stats.get("rounds", 0) + 1


def _stream_with_tools(
    system: str,
    messages: list[dict[str, str]],
    settings: Settings,
    ctx: mentor_tools.ToolContext,
    parts: list[dict[str, Any]],
) -> Generator[dict[str, Any]]:
    """Stream DeepSeek's answer, running the tools it calls (at most MAX_TOOL_ROUNDS rounds) and
    feeding their results back, so text and tool steps reach the screen as they happen."""
    import openai

    from app.services.generation import DEEPSEEK_URL, TIMEOUT_SECONDS

    client = openai.OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=DEEPSEEK_URL,
        timeout=TIMEOUT_SECONDS,
        max_retries=0,
    )
    convo: list[Any] = [{"role": "system", "content": system}]
    convo += [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m["role"] in ("user", "assistant")
    ]
    try:
        for round_ in range(MAX_TOOL_ROUNDS + 1):
            with_tools = round_ < MAX_TOOL_ROUNDS
            stream = client.chat.completions.create(
                model=settings.deepseek_model,
                max_tokens=settings.mentor_max_tokens,
                temperature=settings.mentor_temperature,
                messages=convo,
                extra_body={"thinking": {"type": "disabled"}},
                stream=True,
                stream_options={"include_usage": True},
                tools=cast(Any, mentor_tools.TOOLS) if with_tools else openai.omit,
            )
            said: list[str] = []
            calls: dict[int, dict[str, str]] = {}
            # Tool calls the model wrote as text are kept off the screen (app.services.dsml).
            guard = dsml.Guard()
            for chunk in stream:
                usage = getattr(chunk, "usage", None)  # only the last chunk carries it
                if usage is not None:
                    _count_usage(ctx.stats, usage)
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                shown = guard.feed(delta.content) if delta.content else ""
                if shown:
                    said.append(shown)
                    yield {"delta": shown}
                for call in delta.tool_calls or []:
                    slot = calls.setdefault(call.index, {"id": "", "name": "", "args": ""})
                    if call.id:
                        slot["id"] = call.id
                    if call.function and call.function.name:
                        slot["name"] += call.function.name
                    if call.function and call.function.arguments:
                        slot["args"] += call.function.arguments
            tail = guard.end()
            if tail:
                said.append(tail)
                yield {"delta": tail}
            if guard.markup:
                written = dsml.calls(guard.markup)
                logger.warning(
                    "mentor tool call written as text",
                    extra={"tools": [name for name, _ in written], "run": with_tools},
                )
                # Run them as the calls they are, where tools are offered; past the last round,
                # they are dropped like any call that comes too late.
                if with_tools:
                    after = max(calls, default=-1) + 1
                    for n, (name, args) in enumerate(written):
                        calls[after + n] = {
                            "id": f"text-call-{round_}-{n}",
                            "name": name,
                            "args": json.dumps(args, ensure_ascii=False),
                        }
            if not calls:
                return
            ordered = [calls[i] for i in sorted(calls)]
            convo.append(
                {
                    "role": "assistant",
                    "content": "".join(said) or None,
                    "tool_calls": [
                        {
                            "id": c["id"] or f"call-{n}",
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["args"] or "{}"},
                        }
                        for n, c in enumerate(ordered)
                    ],
                }
            )
            for n, c in enumerate(ordered):
                try:
                    args = json.loads(c["args"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = yield from _run_tool(
                    ctx,
                    c["name"],
                    args if isinstance(args, dict) else {},
                    c["id"] or f"call-{n}",
                    parts,
                )
                convo.append(
                    {
                        "role": "tool",
                        "tool_call_id": c["id"] or f"call-{n}",
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    }
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


SUMMARY_PROMPT = (
    "Summarise this chat between an English learner and their study mentor in at most two short "
    "sentences, in English: what it was about and anything decided or promised. No greetings."
)


def summarize_if_due(
    db: Session, user: User, conversation: MentorConversation, settings: Settings
) -> None:
    """After an answer (ADR 0075): a chat long enough to need it gets a short summary, which later
    chats read. Without a model, its title stands in. A failure leaves the old summary."""
    if not memory.needs_summary(db, conversation):
        return
    if settings.mentor_chat_demo or not settings.deepseek_api_key:
        memory.save_summary(db, conversation, conversation.title)
        return
    try:
        summary = _call_deepseek(
            SUMMARY_PROMPT,
            [{"role": "user", "content": memory.transcript(db, conversation)}],
            settings,
        )
    except ApiError:
        logger.warning("mentor summary failed")
        return
    memory.save_summary(db, conversation, summary)
