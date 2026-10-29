"""Settings, today's pace and how they size new lessons, through the API."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.support import Answers, Play, at, respond

DAY_1 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
NEW = {"kind": "new", "deck_id": "starter"}


def new_word_count(session: dict[str, Any]) -> int:
    return sum(1 for exercise in session["exercises"] if exercise["type"] == "introduce")


def test_a_new_learner_has_no_pace_until_they_choose_one(client: TestClient) -> None:
    assert client.get("/api/me").json() == {
        "daily_target_words": None,
        "study_days_per_week": 6,
        "ramp_enabled": True,
        "onboarded": False,
    }
    changed = client.patch(
        "/api/me", json={"daily_target_words": 3, "study_days_per_week": 5}, headers=at(DAY_1)
    )
    assert changed.json() == {
        "daily_target_words": 3,
        "study_days_per_week": 5,
        "ramp_enabled": True,
        "onboarded": True,
    }


def test_settings_are_validated(client: TestClient) -> None:
    for body in (
        {"daily_target_words": 0},
        {"daily_target_words": 101},
        {"study_days_per_week": 8},
    ):
        assert client.patch("/api/me", json=body).status_code == 422
    assert client.patch("/api/me", json={"nickname": "x"}).status_code == 422


def test_lessons_follow_the_daily_target_and_then_offer_bonus_words(
    client: TestClient, play: Play
) -> None:
    client.patch("/api/me", json={"daily_target_words": 3}, headers=at(DAY_1))
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(DAY_1)).json()
    assert (pace["target"], pace["remaining_today"], pace["next_lesson_size"]) == (3, 3, 3)

    summary = play(NEW, DAY_1)
    assert len(summary["words"]) == 3
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(DAY_1)).json()
    assert (pace["new_words_today"], pace["remaining_today"], pace["bonus"]) == (3, 0, True)

    bonus = play(NEW, DAY_1 + timedelta(minutes=10))
    assert len(bonus["words"]) == 5


def test_a_large_target_warms_up_and_splits_into_lessons(client: TestClient) -> None:
    client.patch("/api/me", json={"daily_target_words": 30}, headers=at(DAY_1))
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(DAY_1)).json()
    assert (pace["ramp_week"], pace["effective_target"], pace["next_lesson_size"]) == (0, 15, 10)
    session = client.post("/api/sessions", json=NEW, headers=at(DAY_1)).json()
    assert new_word_count(session) == 10

    week_3 = DAY_1 + timedelta(days=15)
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(week_3)).json()
    assert (pace["ramp_week"], pace["effective_target"]) == (None, 30)


def test_new_words_wait_while_too_many_reviews_are_due(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 2, "ramp_enabled": False})
    for n in range(5):  # the target (2 words), then four bonus lessons: 22 words in review
        play(NEW, DAY_1 + timedelta(minutes=5 * n))

    later = DAY_1 + timedelta(days=2)
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(later)).json()
    assert pace["blocked_by_reviews"] is True
    assert (pace["due_count"], pace["review_debt_limit"]) == (22, 20)
    refused = client.post("/api/sessions", json=NEW, headers=at(later))
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "reviews_first"
    review = client.post(
        "/api/sessions", json={"kind": "review", "deck_id": "starter"}, headers=at(later)
    )
    assert review.status_code == 200


def review_everything_wrongly(client: TestClient, answers: Answers, moment: datetime) -> None:
    start = {"kind": "review", "deck_id": "starter"}
    while (response := client.post("/api/sessions", json=start, headers=at(moment))).is_success:
        session = response.json()
        for exercise in session["exercises"]:
            client.post(
                f"/api/sessions/{session['id']}/attempts",
                json={"exercise_id": exercise["id"], "response": respond(exercise, answers, False)},
                headers=at(moment),
            )
        client.post(f"/api/sessions/{session['id']}/complete", headers=at(moment))


def test_a_dismissed_suggestion_stays_quiet_for_a_week(
    client: TestClient, play: Play, answers: Answers
) -> None:
    client.patch("/api/me", json={"daily_target_words": 20}, headers=at(DAY_1 - timedelta(days=30)))
    play(NEW, DAY_1)
    play(NEW, DAY_1 + timedelta(minutes=10))  # 20 words: the target is met
    review_everything_wrongly(client, answers, DAY_1 + timedelta(days=1, hours=1))

    today = DAY_1 + timedelta(days=2)
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(today)).json()
    assert pace["suggestion"] == {
        "kind": "lower",
        "value": 14,
        "reason": "low_recall",
        "achieved_per_day": None,
        "recall_percent": 0,
    }

    dismissed = client.post("/api/me/pace/dismiss", json={"kind": "lower"}, headers=at(today))
    assert dismissed.status_code == 204
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(today)).json()
    assert pace["suggestion"] is None
    in_8_days = today + timedelta(days=8)
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(in_8_days)).json()
    assert pace["suggestion"]["kind"] == "lower"


def test_pace_is_only_for_published_decks(client: TestClient) -> None:
    assert client.get("/api/me/pace", params={"deck_id": "nope"}).status_code == 404


def test_no_suggestion_once_the_deck_has_no_new_words(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 20}, headers=at(DAY_1 - timedelta(days=30)))
    for n in range(3):  # 3 × 10 words: the whole deck, each day below the target
        play(NEW, DAY_1 + timedelta(days=n))
    today = DAY_1 + timedelta(days=3)
    pace = client.get("/api/me/pace", params={"deck_id": "starter"}, headers=at(today)).json()
    assert pace["suggestion"] is None
