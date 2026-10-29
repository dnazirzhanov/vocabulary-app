"""Spaced repetition with FSRS, the model behind Anki's modern scheduler (ADR 0012).

Each card keeps three numbers: difficulty (how hard this word is for this learner), stability (how
many days until recall probability falls to 90%) and the time of the last review. After every
rating («Снова / Трудно / Хорошо / Легко») FSRS updates them and schedules the next review for
when the learner is about to forget. New and forgotten cards first go through short learning steps
(1 and 10 minutes), as in Anki.

The maintained `fsrs` library (MIT) does the maths; this module only translates between it and
our tables. Times are aware datetimes; FSRS works in UTC.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fsrs import Card, Rating, Scheduler, State

# Fuzzing (randomly spreading due dates) is off so schedules are reproducible and testable.
SCHEDULER = Scheduler(desired_retention=0.9, enable_fuzzing=False)
RATINGS = (1, 2, 3, 4)  # Снова, Трудно, Хорошо, Легко
AGAIN = 1
# "Помню хорошо": in review, and likely to be recalled three weeks from the last review.
WELL_LEARNED_STABILITY_DAYS = 21.0

LEARNING = State.Learning.value
REVIEW = State.Review.value
RELEARNING = State.Relearning.value


@dataclass(frozen=True)
class CardState:
    """A word's schedule as stored in user_word_progress."""

    state: int
    step: int | None
    stability: float | None
    difficulty: float | None
    due_at: datetime
    last_reviewed_at: datetime | None

    @property
    def is_review(self) -> bool:
        """In review or relearning: the learner has graduated the card at least once."""
        return self.state in (REVIEW, RELEARNING)


def _require_aware(moment: datetime) -> None:
    if moment.tzinfo is None:
        raise ValueError("scheduling needs timezone-aware datetimes")


def _to_fsrs(card: CardState | None, now: datetime) -> Card:
    if card is None:  # a word met for the first time
        return Card(state=State.Learning, step=0, due=now.astimezone(UTC))
    return Card(
        state=State(card.state),
        step=card.step,
        stability=card.stability,
        difficulty=card.difficulty,
        due=card.due_at.astimezone(UTC),
        last_review=card.last_reviewed_at.astimezone(UTC) if card.last_reviewed_at else None,
    )


def review(card: CardState | None, rating: int, now: datetime) -> CardState:
    """The schedule after rating a card at `now`. `card` is None for a new word."""
    _require_aware(now)
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating}")
    after, _ = SCHEDULER.review_card(_to_fsrs(card, now), Rating(rating), now.astimezone(UTC))
    assert after.due is not None
    return CardState(
        state=after.state.value,
        step=after.step,
        stability=after.stability,
        difficulty=after.difficulty,
        due_at=after.due,
        last_reviewed_at=after.last_review,
    )


def previews(card: CardState | None, now: datetime) -> dict[int, timedelta]:
    """How long until the card comes back for each rating, shown under the buttons as in Anki."""
    return {rating: review(card, rating, now).due_at - now for rating in RATINGS}


def is_well_learned(state: int, stability: float | None) -> bool:
    return state == REVIEW and (stability or 0) >= WELL_LEARNED_STABILITY_DAYS


def local_date(moment: datetime, time_zone: ZoneInfo) -> date:
    """The learner's calendar day for a moment — the only place time zones enter."""
    _require_aware(moment)
    return moment.astimezone(time_zone).date()
