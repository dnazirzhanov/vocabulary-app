"""Daily pace: how many new words today, and when to suggest a different target (ADR 0010).

The learner picks a daily target; it is a plan, not a cap. Three rules sit on top of it:

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

from app.models import Deck, DeckWord, PaceDismissal, ReviewAttempt, User, UserWordProgress
from app.schemas.me import PaceOut, SuggestionOut
from app.services import decks
from app.services.progress import INTRODUCTION, local_day_bounds, recall_counts
from app.services.scheduling import local_date

DEFAULT_TARGET = 5  # until the learner chooses (and the size every lesson had before pace)
MAX_TARGET = 100
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
    effective_target: int
    ramp_week: int | None
    new_today: int
    remaining: int
    next_lesson_size: int
    bonus: bool
    blocked_by_reviews: bool
    due: int
    debt_limit: int


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


def plan_day(target: int, week: int | None, new_today: int, due: int) -> DayPlan:
    goal = effective_target(target, week)
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
        blocked_by_reviews=due >= limit,
        due=due,
        debt_limit=limit,
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


def day_plan(db: Session, user: User, deck_id: str, now: datetime, time_zone: ZoneInfo) -> DayPlan:
    today = local_date(now, time_zone)
    start, end = local_day_bounds(today, time_zone)
    new_today = db.scalar(
        select(func.count()).where(
            ReviewAttempt.user_id == user.id,
            INTRODUCTION,
            ReviewAttempt.answered_at >= start,
            ReviewAttempt.answered_at < end,
        )
    )
    target = target_of(user)
    started = local_date(user.onboarded_at, time_zone) if user.onboarded_at else None
    week = ramp_week(target, user.ramp_enabled, started, today)
    return plan_day(target, week, int(new_today or 0), due_count(db, user, now))


def pace_view(db: Session, user: User, deck_id: str, now: datetime, time_zone: ZoneInfo) -> PaceOut:
    plan = day_plan(db, user, deck_id, now, time_zone)
    today = local_date(now, time_zone)
    since, _ = local_day_bounds(today - timedelta(days=HISTORY_DAYS), time_zone)
    history = [
        DayRecord(day, count)
        for day, count in _new_words_by_local_day(db, user, since, time_zone).items()
    ]
    # A pace is about new words: once the deck has none left, there is nothing to adjust.
    suggestion = None
    if words_left(db, user) > 0:
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
