"""Daily pace: how many new words today, and when to suggest a different target (ADR 0010).

The pace is per deck (ADR 0028): each of my own and my groups' decks has its own new words a day,
and the course's levels share one. A day's goal can grow by extra words for that day only, and a
group deck with a teacher's deadline spreads what is left evenly over the days before it.

The learner picks a daily target; it is a pace, not a cap. Three rules sit on top of it:

- a ramp: large targets start at half, then three quarters, so the first weeks feel achievable;
- a review-debt throttle: new words wait while too many reviews are due, because each new word
  costs about five reviews over the following two months and an unpaid backlog means forgetting;
- suggestions: when the learner keeps missing the target (or recalls poorly) the app proposes the
  pace they actually manage; when they keep meeting it easily, a faster one. Nothing changes until
  the learner accepts.

Every number here is a pilot hypothesis. The current time is always passed in.
"""

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    Deck,
    DeckPace,
    DeckWord,
    LearningSession,
    PaceDismissal,
    ReviewAttempt,
    User,
    UserWordProgress,
)
from app.schemas.me import PaceOut, SuggestionOut
from app.services import decks
from app.services.progress import INTRODUCTION, local_day_bounds, recall_counts
from app.services.scheduling import local_date

DEFAULT_TARGET = 5  # until the learner chooses (and the size every lesson had before pace)
MAX_TARGET = 100
MAX_EXTRA = 200  # extra new words one deck can hold for a day (up to 100 at a time)
MAX_LESSON_WORDS = 10  # a bigger daily target becomes several lessons of at most this many words
BONUS_LESSON_WORDS = 5  # "more words" after the target is met
RAMP_MIN_TARGET = 10
RAMP_SHARES = (0.5, 0.75)  # share of the target in the first and second week
REVIEWS_PER_WORD = 5  # one per Leitner stage when every review succeeds
DEBT_FLOOR = 20
DISMISS_QUIET = timedelta(days=7)
DEFAULT_SECONDS_PER_EXERCISE = 10.0
MAX_EXERCISE_GAP = 120.0  # longer pauses are breaks, not answering time
MIN_GAPS = 20
HISTORY_DAYS = 14

LOWER_LOOKBACK = 5  # learning days
LOWER_MISSES = 3
LOW_RECALL = 0.6
LOW_RECALL_MIN_REVIEWS = 20
LOW_RECALL_FACTOR = 0.7
RAISE_LOOKBACK = 7  # calendar days
RAISE_HITS = 5
HIGH_RECALL = 0.85
HIGH_RECALL_MIN_REVIEWS = 10
RAISE_FACTOR = 1.3

SuggestionKind = Literal["lower", "raise"]


@dataclass(frozen=True)
class DayRecord:
    day: date
    new_words: int


@dataclass(frozen=True)
class DayPlan:
    target: int
    # The day's goal: the pace (ramped), or the deadline's share when larger, plus extra words.
    effective_target: int
    ramp_week: int | None
    new_today: int
    remaining: int
    next_lesson_size: int
    bonus: bool
    blocked_by_reviews: bool
    due: int
    debt_limit: int
    deadline: date | None = None
    deadline_share: int = 0
    extra: int = 0


@dataclass(frozen=True)
class Suggestion:
    kind: SuggestionKind
    value: int
    reason: Literal["missed_target", "low_recall", "steady"]
    achieved_per_day: float | None = None
    recall: float | None = None


def ramp_week(target: int, enabled: bool, started_on: date | None, today: date) -> int | None:
    """0 or 1 while a large target is warming up; None once the full target applies."""
    if not enabled or started_on is None or target < RAMP_MIN_TARGET:
        return None
    week = (today - started_on).days // 7
    return week if 0 <= week < len(RAMP_SHARES) else None


def effective_target(target: int, week: int | None) -> int:
    return target if week is None else max(1, math.ceil(target * RAMP_SHARES[week]))


def review_debt_limit(target: int) -> int:
    """About two days of reviews at this pace."""
    return max(DEBT_FLOOR, 2 * REVIEWS_PER_WORD * target)


def deadline_share(left_at_day_start: int, today: date, due_on: date) -> int:
    """New words to meet today so that a deck is done the day before its deadline, which is
    left for review (ADR 0028): an even share of what was left this morning over the days before
    the deadline day. One day left, or the deadline here or past: all of it."""
    if left_at_day_start <= 0:
        return 0
    days = (due_on - today).days
    if days <= 1:
        return left_at_day_start
    return math.ceil(left_at_day_start / days)


def plan_day(
    target: int,
    week: int | None,
    new_today: int,
    due: int,
    *,
    deadline: date | None = None,
    share: int = 0,
    extra: int = 0,
) -> DayPlan:
    goal = max(effective_target(target, week), share) + extra
    remaining = max(0, goal - new_today)
    limit = review_debt_limit(target)
    return DayPlan(
        target=target,
        effective_target=goal,
        ramp_week=week,
        new_today=new_today,
        remaining=remaining,
        next_lesson_size=min(MAX_LESSON_WORDS, remaining) if remaining else BONUS_LESSON_WORDS,
        bonus=remaining == 0,
        # A deadline wins over the review backlog: its words must be met in time.
        blocked_by_reviews=due >= limit and deadline is None,
        due=due,
        debt_limit=limit,
        deadline=deadline,
        deadline_share=share,
        extra=extra,
    )


def seconds_per_exercise(gaps: Sequence[float]) -> float:
    """The learner's median answering time, once there is enough of it to trust."""
    usable = [gap for gap in gaps if 0 < gap <= MAX_EXERCISE_GAP]
    if len(usable) < MIN_GAPS:
        return DEFAULT_SECONDS_PER_EXERCISE
    return round(statistics.median(usable), 1)


def suggest(
    target: int,
    history: Sequence[DayRecord],
    today: date,
    recall: tuple[int, int],
    blocked: bool,
    ramping: bool,
    quiet: frozenset[SuggestionKind] = frozenset(),
) -> Suggestion | None:
    """A different target the learner might prefer, or None. `history` holds past days only
    (today is still in progress); `recall` is (recalled, reviewed) over the recent reviews."""
    if ramping:
        return None
    recalled, reviewed = recall
    rate = recalled / reviewed if reviewed else None
    past = sorted((d for d in history if d.day < today), key=lambda d: d.day)

    if "lower" not in quiet and target > 1:
        # Days with no new words (review-only, or not studying) say nothing about the target.
        learning = [d for d in past if d.new_words > 0][-LOWER_LOOKBACK:]
        misses = sum(1 for d in learning if d.new_words < target)
        if misses >= LOWER_MISSES:
            achieved = statistics.fmean(d.new_words for d in learning)
            value = max(1, math.ceil(achieved))
            if value < target:
                return Suggestion("lower", value, "missed_target", achieved_per_day=achieved)
        if rate is not None and reviewed >= LOW_RECALL_MIN_REVIEWS and rate < LOW_RECALL:
            value = max(1, math.floor(target * LOW_RECALL_FACTOR))
            if value < target:
                return Suggestion("lower", value, "low_recall", recall=rate)

    if "raise" not in quiet and target < MAX_TARGET and not blocked:
        window = {today - timedelta(days=n) for n in range(1, RAISE_LOOKBACK + 1)}
        hits = sum(1 for d in past if d.day in window and d.new_words >= target)
        recalls_well = (
            rate is not None and reviewed >= HIGH_RECALL_MIN_REVIEWS and rate >= HIGH_RECALL
        )
        if hits >= RAISE_HITS and recalls_well:
            value = min(MAX_TARGET, max(target + 1, round(target * RAISE_FACTOR)))
            return Suggestion("raise", value, "steady", recall=rate)
    return None


# --- database-backed views ------------------------------------------------------------------


def recorded_target(plan: DayPlan, left: int) -> int:
    """The day's plan as a study session records it (ADR 0015): the effective target, a bonus
    lesson included; fewer when the course has fewer words left; 0 when no new word is possible
    today (too many reviews due, or every word met)."""
    if plan.blocked_by_reviews:
        return 0
    return min(plan.effective_target, plan.new_today + left)


def target_of(user: User) -> int:
    return user.daily_target_words or DEFAULT_TARGET


def _new_words_by_local_day(
    db: Session, user: User, since: datetime, time_zone: ZoneInfo
) -> dict[date, int]:
    local_day = func.date(func.timezone(time_zone.key, ReviewAttempt.answered_at))
    rows = db.execute(
        select(local_day, func.count())
        .where(
            ReviewAttempt.user_id == user.id,
            INTRODUCTION,
            ReviewAttempt.answered_at >= since,
        )
        .group_by(local_day)
    )
    return {day: int(count) for day, count in rows}


def due_count(db: Session, user: User, now: datetime) -> int:
    """Review debt counts every level: reviews of earlier levels are just as due."""
    count = db.scalar(
        select(func.count())
        .select_from(UserWordProgress)
        .where(UserWordProgress.user_id == user.id, UserWordProgress.due_at <= now)
    )
    return int(count or 0)


def _answer_gaps(db: Session, user: User, since: datetime) -> list[float]:
    previous = func.lag(ReviewAttempt.answered_at).over(
        partition_by=ReviewAttempt.session_id, order_by=ReviewAttempt.answered_at
    )
    gaps = (
        select(func.extract("epoch", ReviewAttempt.answered_at - previous).label("gap"))
        .where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.answered_at >= since,
            # Flashcards only: building a word with tiles takes longer and is timed apart.
            ReviewAttempt.exercise_type == "card",
        )
        .subquery()
    )
    return [float(gap) for gap in db.scalars(select(gaps.c.gap).where(gaps.c.gap.is_not(None)))]


def words_left(db: Session, user: User) -> int:
    """New words still to meet in every deck I study: the course's levels, my own decks and the
    decks given to my groups (ADR 0022). A word in two decks counts once. With none left, the
    day's target is 0: cleared reviews keep the day."""
    introduced = set(
        db.scalars(select(UserWordProgress.word_id).where(UserWordProgress.user_id == user.id))
    )
    given = [item.deck.id for item in decks.assigned_decks(db, user)]
    words = db.scalars(
        select(DeckWord.word_id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(
            or_(
                (Deck.kind == "course") & (Deck.status == "published"),
                Deck.owner_id == user.id,
                Deck.id.in_(given),
            )
        )
    )
    return len(set(words) - introduced)


def _quiet_kinds(db: Session, user: User, now: datetime) -> frozenset[SuggestionKind]:
    kinds = db.scalars(
        select(PaceDismissal.kind).where(
            PaceDismissal.user_id == user.id, PaceDismissal.dismissed_at > now - DISMISS_QUIET
        )
    )
    return frozenset(kind for kind in kinds if kind in ("lower", "raise"))  # type: ignore[misc]


def deck_pace(db: Session, user: User, deck: Deck) -> int:
    """New words a day in this deck: the course's pace for its levels, else the deck's own (the
    course's until the learner sets one)."""
    if deck.kind != "course":
        own = db.scalar(
            select(DeckPace.daily_new).where(
                DeckPace.user_id == user.id, DeckPace.deck_id == deck.id
            )
        )
        if own is not None:
            return int(own)
    return target_of(user)


def _extra_today(db: Session, user: User, deck: Deck, today: date) -> int:
    row = db.get(DeckPace, (user.id, deck.id))
    return int(row.extra_words or 0) if row and row.extra_day == today else 0


def deck_left(db: Session, user: User, deck: Deck) -> int:
    met = select(UserWordProgress.word_id).where(UserWordProgress.user_id == user.id)
    return int(
        db.scalar(
            select(func.count())
            .select_from(DeckWord)
            .where(DeckWord.deck_id == deck.id, DeckWord.word_id.not_in(met))
        )
        or 0
    )


def deadline_of(db: Session, user: User, deck: Deck) -> date | None:
    """The earliest «Выучить к» among my groups that were given this deck (ADR 0028)."""
    given = next((item for item in decks.assigned_decks(db, user) if item.deck.id == deck.id), None)
    return given.due_on if given else None


def day_plan(db: Session, user: User, deck_id: str, now: datetime, time_zone: ZoneInfo) -> DayPlan:
    """Today in one deck (ADR 0028): new words met in it today against its pace, the deadline's
    share and today's extra words. The course's levels count together: they share one pace."""
    deck = db.get_one(Deck, deck_id)
    today = local_date(now, time_zone)
    start, end = local_day_bounds(today, time_zone)
    in_scope = (
        LearningSession.deck_id.in_(select(Deck.id).where(Deck.kind == "course"))
        if deck.kind == "course"
        else LearningSession.deck_id == deck.id
    )
    new_today = int(
        db.scalar(
            select(func.count())
            .select_from(ReviewAttempt)
            .join(LearningSession, LearningSession.id == ReviewAttempt.session_id)
            .where(
                ReviewAttempt.user_id == user.id,
                INTRODUCTION,
                ReviewAttempt.answered_at >= start,
                ReviewAttempt.answered_at < end,
                in_scope,
            )
        )
        or 0
    )
    target = deck_pace(db, user, deck)
    week = None
    if deck.kind == "course":
        started = local_date(user.onboarded_at, time_zone) if user.onboarded_at else None
        week = ramp_week(target, user.ramp_enabled, started, today)
    due_on = deadline_of(db, user, deck)
    share = deadline_share(deck_left(db, user, deck) + new_today, today, due_on) if due_on else 0
    return plan_day(
        target,
        week,
        new_today,
        due_count(db, user, now),
        deadline=due_on,
        share=share,
        extra=_extra_today(db, user, deck, today),
    )


def set_deck_pace(db: Session, user: User, deck: Deck, daily_new: int) -> None:
    """Change a deck's new words a day; course levels change the course's pace."""
    if deck.kind == "course":
        user.daily_target_words = daily_new
    else:
        row = db.get(DeckPace, (user.id, deck.id))
        if row is None:
            db.add(DeckPace(user_id=user.id, deck_id=deck.id, daily_new=daily_new))
        else:
            row.daily_new = daily_new
    db.commit()


def add_extra(db: Session, user: User, deck: Deck, words: int, today: date) -> None:
    """More new words in this deck today only; a second time the same day adds to the first."""
    row = db.get(DeckPace, (user.id, deck.id))
    if row is None:
        row = DeckPace(user_id=user.id, deck_id=deck.id)
        db.add(row)
    earlier = (row.extra_words or 0) if row.extra_day == today else 0
    row.extra_day, row.extra_words = today, min(MAX_EXTRA, earlier + words)
    db.commit()


def pace_view(db: Session, user: User, deck_id: str, now: datetime, time_zone: ZoneInfo) -> PaceOut:
    plan = day_plan(db, user, deck_id, now, time_zone)
    today = local_date(now, time_zone)
    since, _ = local_day_bounds(today - timedelta(days=HISTORY_DAYS), time_zone)
    history = [
        DayRecord(day, count)
        for day, count in _new_words_by_local_day(db, user, since, time_zone).items()
    ]
    # A pace is about new words: once the deck has none left, there is nothing to adjust. Only
    # the course's pace is suggested: a deck's own words are the learner's to plan.
    suggestion = None
    if db.get_one(Deck, deck_id).kind == "course" and words_left(db, user) > 0:
        suggestion = suggest(
            plan.target,
            history,
            today,
            recall_counts(db, user, now),
            plan.blocked_by_reviews,
            ramping=plan.ramp_week is not None,
            quiet=_quiet_kinds(db, user, now),
        )
    return PaceOut(
        deck_id=deck_id,
        target=plan.target,
        effective_target=plan.effective_target,
        ramp_week=plan.ramp_week,
        new_words_today=plan.new_today,
        remaining_today=plan.remaining,
        next_lesson_size=plan.next_lesson_size,
        bonus=plan.bonus,
        blocked_by_reviews=plan.blocked_by_reviews,
        due_count=plan.due,
        review_debt_limit=plan.debt_limit,
        seconds_per_exercise=seconds_per_exercise(_answer_gaps(db, user, since)),
        course=db.get_one(Deck, deck_id).kind == "course",
        deadline=plan.deadline,
        deadline_share=plan.deadline_share,
        extra_today=plan.extra,
        suggestion=SuggestionOut(
            kind=suggestion.kind,
            value=suggestion.value,
            reason=suggestion.reason,
            achieved_per_day=(
                round(suggestion.achieved_per_day, 1)
                if suggestion.achieved_per_day is not None
                else None
            ),
            recall_percent=(
                round(suggestion.recall * 100) if suggestion.recall is not None else None
            ),
        )
        if suggestion
        else None,
    )


def dismiss(db: Session, user: User, kind: SuggestionKind, now: datetime) -> None:
    stmt = insert(PaceDismissal).values(user_id=user.id, kind=kind, dismissed_at=now)
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=[PaceDismissal.user_id, PaceDismissal.kind],
            set_={"dismissed_at": now},
        )
    )
    db.commit()
