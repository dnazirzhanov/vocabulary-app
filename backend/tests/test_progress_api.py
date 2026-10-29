"""Progress, points, the daily goal and streaks through the API, including day boundaries in the
learner's time zone."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.support import Play, at

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
START = {"kind": "study", "deck_id": "starter"}
HARD = {"kind": "hard", "deck_id": "starter"}


def progress(client: TestClient, moment: datetime, time_zone: str = "UTC") -> dict[str, Any]:
    response = client.get("/api/decks/starter/progress", headers=at(moment, time_zone))
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


def test_a_new_learner_starts_from_zero(client: TestClient) -> None:
    report = progress(client, DAY0)
    assert report["words"] == {"introduced": 0, "reviewing": 0, "well_learned": 0, "due": 0}
    assert report["today"] == {"date": "2026-11-02", "points": 0}
    assert (report["daily_goal"], report["streak_days"], report["points_total"]) == (30, 0, 0)
    assert [day["date"] for day in report["week"]] == [
        "2026-10-27",
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
        "2026-11-02",
    ]
    assert all(day["points"] == 0 for day in report["week"])
    assert report["recall"] == {"recalled": 0, "reviewed": 0, "days": 30}


def test_a_lesson_earns_points_and_meets_the_daily_goal(client: TestClient, play: Play) -> None:
    summary = play(START, DAY0)
    assert (summary["points"], summary["today_points"], summary["daily_goal"]) == (50, 50, 30)

    report = progress(client, DAY0)
    assert report["words"] == {"introduced": 5, "reviewing": 5, "well_learned": 0, "due": 0}
    assert report["today"]["points"] == 50
    assert report["streak_days"] == 1
    assert report["week"][-1] == {"date": "2026-11-02", "points": 50}


def test_practice_earns_nothing(client: TestClient, play: Play) -> None:
    play(START, DAY0)
    practice = play(HARD, DAY0 + timedelta(hours=1))
    assert practice["points"] == 0
    assert progress(client, DAY0)["points_total"] == 50


def test_reviews_earn_points_whatever_the_rating_and_recall_is_measured(
    client: TestClient, play: Play
) -> None:
    play(START, DAY0)
    later = DAY0 + timedelta(days=10)
    session = play(START, later, ratings={"house": 1, "water": 4})  # house forgotten
    assert session["points"] == 5 * 5 + 5 * 10

    report = progress(client, later)
    assert report["recall"] == {"recalled": 4, "reviewed": 5, "days": 30}
    assert report["streak_days"] == 1  # a gap of ten days broke the streak
    assert report["points_total"] == 50 + 75


def test_well_learned_once_stable_for_three_weeks(client: TestClient, play: Play) -> None:
    play(START, DAY0, ratings={w: 4 for w in ("house", "water", "friend", "buy", "cheap")})
    moment = DAY0
    for _ in range(3):  # reviews whenever cards fall due, all remembered easily
        moment += timedelta(days=40)
        play(START, moment, ratings={w: 4 for w in ("house", "water", "friend", "buy", "cheap")})
    words = progress(client, moment)["words"]
    assert words["well_learned"] >= 5


def test_a_missed_day_breaks_the_streak(client: TestClient, play: Play) -> None:
    play(START, DAY0)
    play(START, DAY0 + timedelta(days=2))  # day 1 skipped
    assert progress(client, DAY0 + timedelta(days=2))["streak_days"] == 1
    # The streak survives until today's practice could still happen.
    assert progress(client, DAY0 + timedelta(days=3))["streak_days"] == 1
    assert progress(client, DAY0 + timedelta(days=4))["streak_days"] == 0


def test_days_are_counted_in_the_learners_time_zone(client: TestClient, play: Play) -> None:
    late = datetime(2026, 11, 2, 20, 0, tzinfo=UTC)  # already 3 November in Bishkek (UTC+6)
    play(START, late, time_zone="Asia/Bishkek")
    bishkek = progress(client, late, "Asia/Bishkek")
    utc = progress(client, late, "UTC")
    assert bishkek["today"] == {"date": "2026-11-03", "points": 50}
    assert utc["today"] == {"date": "2026-11-02", "points": 50}


def test_a_daylight_saving_night_is_one_local_day(client: TestClient, play: Play) -> None:
    # 00:30 and 23:30 local on 25 Oct 2026, the night Berlin's clocks go back: one 25-hour day.
    early = datetime(2026, 10, 24, 22, 30, tzinfo=UTC)
    late = datetime(2026, 10, 25, 22, 30, tzinfo=UTC)
    play(START, early, time_zone="Europe/Berlin")
    play(START, late, time_zone="Europe/Berlin")
    week = progress(client, late, "Europe/Berlin")["week"]
    assert week[-1] == {"date": "2026-10-25", "points": 100}
    assert week[-2]["points"] == 0


def test_an_unknown_time_zone_falls_back_to_utc(client: TestClient) -> None:
    for bad in ("Mars/Olympus", "../../etc/passwd", "x" * 200):
        assert progress(client, DAY0, bad)["today"]["date"] == "2026-11-02"


def test_progress_for_an_unknown_deck(client: TestClient) -> None:
    response = client.get("/api/decks/nope/progress")
    assert (response.status_code, response.json()["error"]["code"]) == (404, "deck_not_found")
