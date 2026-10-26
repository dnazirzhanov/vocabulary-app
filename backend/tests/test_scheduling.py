from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.scheduling import (
    INTERVALS,
    TOP_STAGE,
    after_review,
    first_schedule,
    is_due,
    is_well_learned,
    local_date,
)

NOON = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)


def test_first_exposure_is_reviewed_the_next_day() -> None:
    schedule = first_schedule(NOON)
    assert (schedule.stage, schedule.due_at) == (1, NOON + timedelta(days=1))


def test_correct_first_review_moves_up_one_stage() -> None:
    schedule = after_review(1, recalled=True, reviewed_at=NOON)
    assert (schedule.stage, schedule.due_at) == (2, NOON + timedelta(days=3))


def test_incorrect_review_returns_the_next_day() -> None:
    schedule = after_review(4, recalled=False, reviewed_at=NOON)
    assert (schedule.stage, schedule.due_at) == (1, NOON + timedelta(days=1))


def test_repeated_incorrect_reviews_keep_the_word_close() -> None:
    stage, moment = 3, NOON
    for _ in range(3):
        schedule = after_review(stage, recalled=False, reviewed_at=moment)
        assert schedule.stage == 1 and schedule.due_at - moment == timedelta(days=1)
        stage, moment = schedule.stage, schedule.due_at


def test_intervals_grow_with_each_successful_review_and_cap() -> None:
    stage, moment, gaps = 1, NOON, []
    for _ in range(7):
        schedule = after_review(stage, recalled=True, reviewed_at=moment)
        gaps.append((schedule.due_at - moment).days)
        stage, moment = schedule.stage, schedule.due_at
    assert gaps == [3, 7, 16, 35, 35, 35, 35]
    assert stage == TOP_STAGE
    assert sorted(INTERVALS.values()) == list(INTERVALS.values())


def test_due_exactly_at_the_scheduled_moment() -> None:
    due = NOON + timedelta(days=1)
    assert not is_due(due, due - timedelta(microseconds=1))
    assert is_due(due, due)
    assert is_due(due, due + timedelta(days=30))


def test_well_learned_needs_three_delayed_recalls_in_a_row() -> None:
    stage = first_schedule(NOON).stage
    for expected in (False, False, True):
        stage = after_review(stage, recalled=True, reviewed_at=NOON).stage
        assert is_well_learned(stage) is expected
    assert not is_well_learned(after_review(stage, recalled=False, reviewed_at=NOON).stage)


def test_daylight_saving_never_shifts_an_interval() -> None:
    # Europe/Berlin leaves summer time on 25 Oct 2026 at 03:00 local.
    berlin = ZoneInfo("Europe/Berlin")
    evening_before = datetime(2026, 10, 24, 21, 30, tzinfo=berlin)
    schedule = first_schedule(evening_before)
    assert schedule.due_at - evening_before == timedelta(hours=24)
    # Local clock time moves by an hour, but it is still the next calendar day.
    assert schedule.due_at.astimezone(berlin).hour == 20
    assert local_date(schedule.due_at, berlin) == local_date(evening_before, berlin) + timedelta(
        days=1
    )


def test_local_day_depends_on_the_learners_time_zone() -> None:
    # 20:00 UTC is already the next day in Bishkek (UTC+6) but not in UTC.
    late = datetime(2026, 10, 25, 20, 0, tzinfo=UTC)
    assert local_date(late, ZoneInfo("Asia/Bishkek")).day == 26
    assert local_date(late, ZoneInfo("UTC")).day == 25


def test_naive_datetimes_are_refused() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        first_schedule(datetime(2026, 10, 25, 12, 0))
    with pytest.raises(ValueError, match="unknown stage"):
        after_review(9, recalled=True, reviewed_at=NOON)
