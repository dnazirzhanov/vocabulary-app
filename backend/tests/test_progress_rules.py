from datetime import UTC, date, timedelta
from zoneinfo import ZoneInfo

from app.services.progress import (
    INTRODUCED_POINTS,
    MISSED_REVIEW_POINTS,
    RECALLED_POINTS,
    local_day_bounds,
    points_for,
    streak,
)

TODAY = date(2026, 11, 10)


def test_points_reward_evidence_not_activity() -> None:
    assert points_for("introduce", None) == INTRODUCED_POINTS
    assert points_for("type_word", True) == RECALLED_POINTS
    assert points_for("type_word", False) == MISSED_REVIEW_POINTS
    # Answers that do not finish a review word (lessons, practice, a review's first step) earn
    # nothing.
    assert points_for("choose_meaning", None) == 0
    assert points_for("recall_meaning", None) == 0
    assert RECALLED_POINTS > INTRODUCED_POINTS > MISSED_REVIEW_POINTS


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
