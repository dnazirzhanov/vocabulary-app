"""Progress through the API (ADR 0015): words, plan days against the learner's own promise, the
weekly streak, and day boundaries in the learner's time zone."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DeckWord, User, UserWordProgress
from tests.support import Play, at

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
START = {"kind": "study", "deck_id": "a1-a2"}
HARD = {"kind": "hard", "deck_id": "a1-a2"}


def progress(client: TestClient, moment: datetime, time_zone: str = "UTC") -> dict[str, Any]:
    response = client.get("/api/progress", headers=at(moment, time_zone))
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


def test_a_new_learner_starts_from_zero(client: TestClient) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    report = progress(client, DAY0)
    assert report["words"] == {"introduced": 0, "reviewing": 0, "well_learned": 0, "due": 0}
    assert report["today"] == {
        "date": "2026-11-02",
        "active": False,
        "studied": False,
        "cards": 0,
    }
    assert report["streak_weeks"] == 0
    assert report["activity"] == []  # only days with answers are listed
    assert report["promised_days"] == 6  # the default weekly promise
    assert report["recall"] == {"recalled": 0, "reviewed": 0, "days": 30}
    assert "points" not in str(report)


def test_a_finished_lesson_makes_today_a_study_day(client: TestClient, play: Play) -> None:
    play(START, DAY0)
    report = progress(client, DAY0)
    assert report["words"] == {"introduced": 5, "reviewing": 5, "well_learned": 0, "due": 0}
    today = {"date": "2026-11-02", "active": True, "studied": True, "cards": 15}
    assert report["today"] == today
    assert report["activity"] == [today]


def test_finished_practice_alone_is_a_study_day_too(client: TestClient, play: Play) -> None:
    play(START, DAY0, ratings={"house": 1})
    tuesday = DAY0 + timedelta(days=1)
    play(HARD, tuesday)
    report = progress(client, tuesday)
    assert (report["today"]["active"], report["today"]["studied"]) == (True, True)


def test_reviews_count_as_recall_and_a_gap_does_not_undo_past_days(
    client: TestClient, play: Play
) -> None:
    play(START, DAY0)
    later = DAY0 + timedelta(days=10)
    play(START, later, ratings={"house": 1, "water": 4})  # house forgotten
    report = progress(client, later)
    assert report["recall"] == {"recalled": 4, "reviewed": 5, "days": 30}
    assert [day["date"] for day in report["activity"] if day["studied"]] == [
        "2026-11-02",
        "2026-11-12",
    ]


def test_well_learned_once_stable_for_three_weeks(client: TestClient, play: Play) -> None:
    play(START, DAY0, ratings={w: 4 for w in ("house", "water", "friend", "buy", "cheap")})
    moment = DAY0
    for _ in range(3):  # reviews whenever cards fall due, all remembered easily
        moment += timedelta(days=40)
        play(START, moment, ratings={w: 4 for w in ("house", "water", "friend", "buy", "cheap")})
    words = progress(client, moment)["words"]
    assert words["well_learned"] >= 5


def test_the_streak_counts_weeks_with_the_promise_kept(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"study_days_per_week": 2})
    for week in range(2):  # two weeks, the two days promised each: Monday and Tuesday
        for n in range(2):
            play(START, DAY0 + timedelta(days=7 * week + n))
    second_wednesday = DAY0 + timedelta(days=9)
    assert progress(client, second_wednesday)["streak_weeks"] == 2
    # The next week is not broken while it is under way, and ends the streak once it is over.
    assert progress(client, DAY0 + timedelta(days=16))["streak_weeks"] == 2
    assert progress(client, DAY0 + timedelta(days=21))["streak_weeks"] == 0


def test_days_are_counted_in_the_learners_time_zone(client: TestClient, play: Play) -> None:
    late = datetime(2026, 11, 2, 20, 0, tzinfo=UTC)  # already 3 November in Bishkek (UTC+6)
    play(START, late, time_zone="Asia/Bishkek")
    bishkek = progress(client, late, "Asia/Bishkek")
    utc = progress(client, late, "UTC")
    assert (bishkek["today"]["date"], bishkek["today"]["studied"]) == ("2026-11-03", True)
    assert (utc["today"]["date"], utc["today"]["studied"]) == ("2026-11-02", True)


def test_a_daylight_saving_night_is_one_local_day(client: TestClient, play: Play) -> None:
    # 00:30 and 23:30 local on 25 Oct 2026, the night Berlin's clocks go back: one 25-hour day.
    early = datetime(2026, 10, 24, 22, 30, tzinfo=UTC)
    late = datetime(2026, 10, 25, 22, 30, tzinfo=UTC)
    play(START, early, time_zone="Europe/Berlin")
    play(START, late, time_zone="Europe/Berlin")
    activity = progress(client, late, "Europe/Berlin")["activity"]
    assert [(day["date"], day["cards"]) for day in activity] == [("2026-10-25", 30)]


def test_an_unknown_time_zone_falls_back_to_utc(client: TestClient) -> None:
    for bad in ("Mars/Olympus", "../../etc/passwd", "x" * 200):
        assert progress(client, DAY0, bad)["today"]["date"] == "2026-11-02"


def test_words_count_across_every_level(client: TestClient, db: Session) -> None:
    client.get("/api/decks")  # creates the dev user
    user = db.scalars(select(User)).one()
    for deck_id in ("a1-a2", "b1-b2"):
        for word_id in db.scalars(
            select(DeckWord.word_id).where(DeckWord.deck_id == deck_id)
        ).all()[:3]:
            db.add(
                UserWordProgress(
                    user_id=user.id,
                    word_id=word_id,
                    introduced_at=DAY0,
                    last_seen_at=DAY0,
                    fsrs_state=2,
                    stability=30.0,
                    difficulty=5.0,
                    due_at=DAY0 + timedelta(days=30),
                )
            )
    db.commit()
    words = progress(client, DAY0)["words"]
    assert (words["introduced"], words["well_learned"]) == (6, 6)


def test_the_weekly_promise_follows_the_chosen_pace(client: TestClient) -> None:
    client.patch("/api/me", json={"study_days_per_week": 4})
    assert progress(client, DAY0)["promised_days"] == 4
