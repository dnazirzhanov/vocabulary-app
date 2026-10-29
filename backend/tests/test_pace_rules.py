"""Pace rules (ADR 0010) as pure functions: the ramp, the review-debt throttle, suggestions."""

from datetime import date, timedelta

import pytest

from app.services.pace import (
    DEFAULT_SECONDS_PER_EXERCISE,
    DayRecord,
    effective_target,
    plan_day,
    ramp_week,
    seconds_per_exercise,
    suggest,
)

TODAY = date(2026, 11, 20)


def days(*new_words: int) -> list[DayRecord]:
    """Past days ending yesterday, oldest first."""
    return [
        DayRecord(TODAY - timedelta(days=len(new_words) - i), n) for i, n in enumerate(new_words)
    ]


@pytest.mark.parametrize(
    ("target", "started_days_ago", "expected"),
    [(20, 0, 0), (20, 6, 0), (20, 7, 1), (20, 13, 1), (20, 14, None), (5, 0, None)],
)
def test_large_targets_warm_up_over_two_weeks(
    target: int, started_days_ago: int, expected: int | None
) -> None:
    started = TODAY - timedelta(days=started_days_ago)
    assert ramp_week(target, True, started, TODAY) == expected


def test_the_ramp_can_be_switched_off() -> None:
    assert ramp_week(20, False, TODAY, TODAY) is None


def test_ramp_shares_round_up() -> None:
    assert [effective_target(15, w) for w in (0, 1, None)] == [8, 12, 15]


def test_the_target_splits_into_lessons_and_then_offers_bonus_lessons() -> None:
    first = plan_day(25, None, new_today=0, due=0)
    assert (first.remaining, first.next_lesson_size, first.bonus) == (25, 10, False)
    last = plan_day(25, None, new_today=20, due=0)
    assert (last.remaining, last.next_lesson_size) == (5, 5)
    done = plan_day(25, None, new_today=26, due=0)
    assert (done.remaining, done.next_lesson_size, done.bonus) == (0, 5, True)


def test_new_words_wait_only_when_reviews_pile_up() -> None:
    assert not plan_day(2, None, 0, due=19).blocked_by_reviews
    assert plan_day(2, None, 0, due=20).blocked_by_reviews  # the floor
    assert not plan_day(5, None, 0, due=49).blocked_by_reviews
    assert plan_day(5, None, 0, due=50).blocked_by_reviews  # two days of reviews at 5 a day
    # A fast learner's normal daily reviews never trigger it: the limit grows with the pace.
    assert not plan_day(50, None, 0, due=300).blocked_by_reviews
    assert plan_day(50, None, 0, due=500).blocked_by_reviews


def test_answering_time_needs_enough_history_and_ignores_breaks() -> None:
    assert seconds_per_exercise([6.0] * 19) == DEFAULT_SECONDS_PER_EXERCISE
    assert seconds_per_exercise([6.0] * 20 + [900.0] * 30) == 6.0


def test_a_learner_who_keeps_missing_is_offered_what_they_actually_manage() -> None:
    suggestion = suggest(20, days(6, 5, 7, 0, 6, 6), TODAY, (0, 0), False, ramping=False)
    assert suggestion is not None
    assert (suggestion.kind, suggestion.value, suggestion.reason) == ("lower", 6, "missed_target")
    assert suggestion.achieved_per_day == pytest.approx(6.0)


def test_review_only_days_are_not_counted_as_misses() -> None:
    assert suggest(5, days(5, 0, 0, 0, 5), TODAY, (0, 0), False, ramping=False) is None


def test_poor_recall_suggests_slowing_down() -> None:
    suggestion = suggest(10, days(10, 10, 10), TODAY, (10, 25), False, ramping=False)
    assert suggestion is not None
    assert (suggestion.kind, suggestion.value, suggestion.reason) == ("lower", 7, "low_recall")


def test_a_steady_learner_who_recalls_well_is_offered_more() -> None:
    suggestion = suggest(10, days(10, 12, 10, 0, 10, 11, 10), TODAY, (19, 20), False, False)
    assert suggestion is not None
    assert (suggestion.kind, suggestion.value) == ("raise", 13)


def test_no_raise_without_evidence_of_recall_or_while_behind_on_reviews() -> None:
    week = days(10, 10, 10, 10, 10, 10, 10)
    assert suggest(10, week, TODAY, (5, 5), False, ramping=False) is None  # too few reviews
    assert suggest(10, week, TODAY, (19, 20), True, ramping=False) is None  # blocked


def test_no_suggestions_while_warming_up_or_after_a_dismissal() -> None:
    missing = days(2, 2, 2, 2, 2)
    assert suggest(10, missing, TODAY, (0, 0), False, ramping=True) is None
    assert suggest(10, missing, TODAY, (0, 0), False, False, quiet=frozenset({"lower"})) is None


def test_today_is_still_in_progress_and_never_counts() -> None:
    history = [*days(10, 10, 10, 10), DayRecord(TODAY, 1)]
    assert suggest(10, history, TODAY, (0, 0), False, ramping=False) is None
