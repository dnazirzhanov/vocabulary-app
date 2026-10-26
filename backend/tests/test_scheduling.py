"""The FSRS wrapper (ADR 0012): ratings move cards through learning steps into review."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.scheduling import (
    LEARNING,
    RELEARNING,
    REVIEW,
    is_well_learned,
    local_date,
    previews,
    review,
)

NOON = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


def test_a_new_word_goes_through_learning_steps_before_review() -> None:
    first = review(None, 3, NOON)  # «Хорошо» on first sight: the next learning step
    assert (first.state, first.due_at - NOON) == (LEARNING, timedelta(minutes=10))
    graduated = review(first, 3, NOON + timedelta(minutes=10))
    assert graduated.state == REVIEW
    assert graduated.due_at - NOON > timedelta(days=1)


def test_easy_skips_the_learning_steps_and_again_starts_them_over() -> None:
    assert review(None, 4, NOON).state == REVIEW
    assert review(None, 1, NOON).due_at - NOON == timedelta(minutes=1)


def test_forgetting_a_review_card_sends_it_to_relearning_and_raises_its_difficulty() -> None:
    card = review(review(None, 3, NOON), 3, NOON + timedelta(minutes=10))
    lapsed = review(card, 1, card.due_at)
    assert lapsed.state == RELEARNING
    assert (lapsed.difficulty or 0) > (card.difficulty or 0)
    assert (lapsed.stability or 0) < (card.stability or 0)


def test_previews_grow_with_the_rating() -> None:
    card = review(review(None, 3, NOON), 3, NOON + timedelta(minutes=10))
    shown = previews(card, card.due_at)
    assert shown[1] < shown[2] < shown[3] < shown[4]
    assert shown[1] <= timedelta(minutes=10)


def test_well_learned_means_in_review_and_stable_for_three_weeks() -> None:
    assert is_well_learned(REVIEW, 30.0)
    assert not is_well_learned(REVIEW, 5.0)
    assert not is_well_learned(RELEARNING, 30.0)


def test_times_must_be_aware_and_ratings_known() -> None:
    with pytest.raises(ValueError):
        review(None, 3, datetime(2026, 11, 2, 12, 0))
    with pytest.raises(ValueError):
        review(None, 5, NOON)


def test_local_dates_follow_the_learners_zone() -> None:
    late = datetime(2026, 11, 2, 20, 0, tzinfo=UTC)
    assert local_date(late, ZoneInfo("Asia/Bishkek")).day == 3
