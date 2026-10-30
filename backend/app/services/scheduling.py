"""Spaced repetition with FSRS, the model behind Anki's modern scheduler (ADR 0012).

Each card keeps three numbers: difficulty (how hard this word is for this learner), stability (how
many days until recall probability falls to 90%) and the time of the last review. After every
rating («Снова / Трудно / Хорошо / Легко») FSRS updates them and schedules the next review for
when the learner is about to forget. New and forgotten cards first go through short learning steps
(1 and 10 minutes), as in Anki.

The maintained `fsrs` library (MIT) does the maths; this module translates between it and our
tables and adds what Anki does around it (ADR 0025):
- Days are the learner's days, starting at 4 AM in their time zone. Time since the last review is
  counted in those days (the library counts 24-hour periods), and a card scheduled in days is due
  from the start of its day (the library gives an exact timestamp), so tomorrow's reviews are all
  there in the morning, whatever the hour they were answered today.
- Longer for a better answer: a card going to review in days waits at least one day more after
  «Хорошо» than after «Трудно», and after «Легко» than after «Хорошо» (Anki's `.max(hard + 1)`).
Learning steps stay exact minutes. Times are aware datetimes; FSRS works in UTC.
"""

from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, time, timedelta
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
# Anki's default «next day starts at»: a late-night session still counts as the evening before.
DAY_STARTS_AT = time(4)


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
    # A fixed card_id: without one the library sleeps a millisecond to make a timestamp id unique.
    if card is None:  # a word met for the first time
        return Card(card_id=0, state=State.Learning, step=0, due=now.astimezone(UTC))
    return Card(
        card_id=0,
        state=State(card.state),
        step=card.step,
        stability=card.stability,
        difficulty=card.difficulty,
        due=card.due_at.astimezone(UTC),
        last_review=card.last_reviewed_at.astimezone(UTC) if card.last_reviewed_at else None,
    )


def study_day(moment: datetime, time_zone: ZoneInfo) -> date:
    """The learner's scheduling day: it starts at 4 AM local time, as in Anki."""
    _require_aware(moment)
    local = moment.astimezone(time_zone)
    return (local - timedelta(hours=DAY_STARTS_AT.hour)).date()


def day_start(day: date, time_zone: ZoneInfo) -> datetime:
    return datetime.combine(day, DAY_STARTS_AT, tzinfo=time_zone).astimezone(UTC)


def _library_review(
    card: CardState | None, rating: int, now: datetime, time_zone: ZoneInfo
) -> CardState:
    fsrs_card = _to_fsrs(card, now)
    if card is not None and card.last_reviewed_at is not None:
        # The library takes elapsed time as whole 24-hour periods since the last review; give it
        # a last review exactly as many of those ago as there are study days in between.
        days = (study_day(now, time_zone) - study_day(card.last_reviewed_at, time_zone)).days
        fsrs_card.last_review = now.astimezone(UTC) - timedelta(days=max(days, 0))
    after, _ = SCHEDULER.review_card(fsrs_card, Rating(rating), now.astimezone(UTC))
    assert after.due is not None
    return CardState(
        state=after.state.value,
        step=after.step,
        stability=after.stability,
        difficulty=after.difficulty,
        due_at=after.due,
        last_reviewed_at=now.astimezone(UTC),
    )


def _in_days(after: CardState, now: datetime) -> int | None:
    """The interval in days when the card goes to review; None for a learning step."""
    if after.state != REVIEW:
        return None
    return round((after.due_at - now) / timedelta(days=1))


def review(card: CardState | None, rating: int, now: datetime, time_zone: ZoneInfo) -> CardState:
    """The schedule after rating a card at `now`. `card` is None for a new word."""
    _require_aware(now)
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating}")
    after = _library_review(card, rating, now, time_zone)
    days = _in_days(after, now)
    if days is None:
        return after
    # Each better answer waits at least a day longer than the one below it, if that one also
    # went to review in days.
    for lower in range(rating - 1, 1, -1):
        below = _in_days(_library_review(card, lower, now, time_zone), now)
        if below is None:
            break
        days = max(days, below + rating - lower)
    return replace(
        after, due_at=day_start(study_day(now, time_zone) + timedelta(days=days), time_zone)
    )


def previews(card: CardState | None, now: datetime, time_zone: ZoneInfo) -> dict[int, timedelta]:
    """How long until the card comes back for each rating, shown under the buttons as in Anki:
    minutes for a learning step, whole days for a review."""
    shown = {}
    for rating in RATINGS:
        after = review(card, rating, now, time_zone)
        if after.state == REVIEW:
            days = study_day(after.due_at, time_zone) - study_day(now, time_zone)
            shown[rating] = timedelta(days=days.days)
        else:
            shown[rating] = after.due_at - now
    return shown


def is_well_learned(state: int, stability: float | None) -> bool:
    return state == REVIEW and (stability or 0) >= WELL_LEARNED_STABILITY_DAYS


def local_date(moment: datetime, time_zone: ZoneInfo) -> date:
    """The learner's calendar day for a moment — the only place time zones enter."""
    _require_aware(moment)
    return moment.astimezone(time_zone).date()
