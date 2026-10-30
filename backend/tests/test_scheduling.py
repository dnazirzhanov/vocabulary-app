"""The FSRS wrapper (ADR 0012): ratings move cards through learning steps into review."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.scheduling import (
    LEARNING,
    RELEARNING,
    REVIEW,
    CardState,
    is_well_learned,
    local_date,
    previews,
    review,
    study_day,
)

NOON = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
BISHKEK = ZoneInfo("Asia/Bishkek")  # UTC+6: noon UTC is 18:00 there


def test_a_new_word_goes_through_learning_steps_before_review() -> None:
    first = review(None, 3, NOON, BISHKEK)  # «Хорошо» on first sight: the next learning step
    assert (first.state, first.due_at - NOON) == (LEARNING, timedelta(minutes=10))
    graduated = review(first, 3, NOON + timedelta(minutes=10), BISHKEK)
    assert graduated.state == REVIEW
    assert graduated.due_at - NOON > timedelta(days=1)


def test_easy_skips_the_learning_steps_and_again_starts_them_over() -> None:
    assert review(None, 4, NOON, BISHKEK).state == REVIEW
    assert review(None, 1, NOON, BISHKEK).due_at - NOON == timedelta(minutes=1)


def test_forgetting_a_review_card_sends_it_to_relearning_and_raises_its_difficulty() -> None:
    card = review(review(None, 3, NOON, BISHKEK), 3, NOON + timedelta(minutes=10), BISHKEK)
    lapsed = review(card, 1, card.due_at, BISHKEK)
    assert lapsed.state == RELEARNING
    assert (lapsed.difficulty or 0) > (card.difficulty or 0)
    assert (lapsed.stability or 0) < (card.stability or 0)


def test_previews_grow_with_the_rating() -> None:
    card = review(review(None, 3, NOON, BISHKEK), 3, NOON + timedelta(minutes=10), BISHKEK)
    shown = previews(card, card.due_at, BISHKEK)
    assert shown[1] < shown[2] < shown[3] < shown[4]
    assert shown[1] <= timedelta(minutes=10)


def test_well_learned_means_in_review_and_stable_for_three_weeks() -> None:
    assert is_well_learned(REVIEW, 30.0)
    assert not is_well_learned(REVIEW, 5.0)
    assert not is_well_learned(RELEARNING, 30.0)


def test_times_must_be_aware_and_ratings_known() -> None:
    with pytest.raises(ValueError):
        review(None, 3, datetime(2026, 11, 2, 12, 0), BISHKEK)
    with pytest.raises(ValueError):
        review(None, 5, NOON, BISHKEK)


def test_local_dates_follow_the_learners_zone() -> None:
    late = datetime(2026, 11, 2, 20, 0, tzinfo=UTC)
    assert local_date(late, ZoneInfo("Asia/Bishkek")).day == 3


# --- Anki's days (ADR 0025) -------------------------------------------------------------------


def at(day: int, hour: int, minute: int = 0) -> datetime:
    """A moment in Bishkek in November 2026."""
    return datetime(2026, 11, day, hour, minute, tzinfo=BISHKEK)


def in_review(stability: float, last: datetime) -> CardState:
    return CardState(
        state=REVIEW,
        step=None,
        stability=stability,
        difficulty=5.0,
        due_at=last,
        last_reviewed_at=last,
    )


def test_the_study_day_starts_at_four_in_the_morning() -> None:
    assert study_day(at(3, 3, 59), BISHKEK).day == 2  # a late night still counts as the evening
    assert study_day(at(3, 4, 0), BISHKEK).day == 3
    assert study_day(at(3, 23, 30), BISHKEK).day == 3


def test_a_review_in_days_is_due_from_four_in_the_morning_of_its_day() -> None:
    # Answered at 18:00 or at 9:00, a three-day card is due on the same morning.
    for answered in (at(2, 9), at(2, 18), at(3, 2)):  # 02:00 on the 3rd is still the 2nd
        card = review(None, 4, answered, BISHKEK)
        assert card.state == REVIEW
        due = card.due_at.astimezone(BISHKEK)
        assert (due.hour, due.minute) == (4, 0)
        assert (due.date() - study_day(answered, BISHKEK)).days == round(card.stability or 0)
    # Learning steps stay exact minutes.
    assert review(None, 3, at(2, 23, 55), BISHKEK).due_at == at(3, 0, 5)


def test_elapsed_time_is_counted_in_study_days_not_24_hour_periods() -> None:
    """Reviewed 22:00, answered again 08:00 next day: ten hours, but one study day later — a
    review, not a same-day repeat. 23:00 to 03:00 is the same study day."""
    last = at(2, 22)
    next_morning = review(in_review(1.0, last), 3, at(3, 8), BISHKEK)
    a_day_later = review(in_review(1.0, last), 3, at(3, 22), BISHKEK)
    assert next_morning.stability == pytest.approx(a_day_later.stability or 0)
    same_night = review(in_review(1.0, at(2, 23)), 3, at(3, 3), BISHKEK)
    same_evening = review(in_review(1.0, at(2, 23)), 3, at(2, 23, 30), BISHKEK)
    assert same_night.stability == pytest.approx(same_evening.stability or 0)
    # The record keeps the real moment.
    assert next_morning.last_reviewed_at == at(3, 8)


def test_a_better_answer_always_waits_at_least_a_day_longer() -> None:
    for stability in (0.3, 0.6, 1, 1.5, 2, 3, 10, 40):
        for difficulty in (1, 5, 9, 10):
            card = CardState(
                state=REVIEW,
                step=None,
                stability=stability,
                difficulty=difficulty,
                due_at=at(3, 4),
                last_reviewed_at=at(2, 12),
            )
            shown = previews(card, at(3, 12), BISHKEK)
            days = [shown[g] / timedelta(days=1) for g in (2, 3, 4)]
            assert all(d == int(d) for d in days)
            assert days[0] < days[1] < days[2], (stability, difficulty, days)
            assert shown[1] == timedelta(minutes=10)
