from datetime import UTC, date, timedelta
from zoneinfo import ZoneInfo

from app.services.progress import (
    INTRODUCED_POINTS,
    REVIEWED_POINTS,
    card_points,
    local_day_bounds,
    streak,
)

TODAY = date(2026, 11, 10)


def test_points_reward_studying_never_the_rating() -> None:
    assert card_points(practice=False, first_showing=True, was_review=False) == INTRODUCED_POINTS
    assert card_points(practice=False, first_showing=False, was_review=True) == REVIEWED_POINTS
    # Extra showings while learning, and all practice, earn nothing.
    assert card_points(practice=False, first_showing=False, was_review=False) == 0
    assert card_points(practice=True, first_showing=True, was_review=False) == 0


def test_streak_counts_back_from_today() -> None:
    days = {TODAY - timedelta(days=n) for n in range(3)}
    assert streak(days, TODAY) == 3


def test_streak_is_kept_until_today_is_over() -> None:
    days = {TODAY - timedelta(days=n) for n in range(1, 5)}
    assert streak(days, TODAY) == 4


def test_a_missed_day_breaks_the_streak() -> None:
    days = {TODAY, TODAY - timedelta(days=1), TODAY - timedelta(days=3)}
    assert streak(days, TODAY) == 2
    assert streak(set(), TODAY) == 0
    assert streak({TODAY - timedelta(days=2)}, TODAY) == 0


def test_local_days_follow_the_learners_time_zone() -> None:
    start, end = local_day_bounds(TODAY, ZoneInfo("Asia/Bishkek"))
    assert start.astimezone(UTC).hour == 18  # 00:00 in Bishkek is 18:00 UTC the day before
    assert end - start == timedelta(hours=24)


def test_a_daylight_saving_day_has_its_real_length() -> None:
    berlin = ZoneInfo("Europe/Berlin")
    start, end = local_day_bounds(date(2026, 10, 25), berlin)  # clocks go back an hour
    assert end.astimezone(UTC) - start.astimezone(UTC) == timedelta(hours=25)
    start, end = local_day_bounds(date(2027, 3, 28), berlin)  # clocks go forward
    assert end.astimezone(UTC) - start.astimezone(UTC) == timedelta(hours=23)
