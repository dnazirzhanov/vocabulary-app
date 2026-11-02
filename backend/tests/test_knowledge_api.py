"""Progress by deck and the kept day (ADR 0022): what I've learned of each deck I study, and a day
kept only with every due review done."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.support import Play, Ratings, at, finish

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
LATER = DAY0 + timedelta(days=10)


def own_deck(client: TestClient, words: list[str]) -> dict[str, Any]:
    deck: dict[str, Any] = client.post(
        "/api/decks", json={"title": "Путешествия"}, headers=at(DAY0)
    ).json()
    for word in words:
        client.post(
            f"/api/decks/{deck['id']}/words",
            json={
                "headword": word,
                "pos": "noun",
                "translation": "перевод",
                "example": f"A {word}.",
            },
            headers=at(DAY0),
        )
    return deck


def study(
    client: TestClient, deck_id: str, moment: datetime, ratings: Ratings | None = None
) -> None:
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck_id}, headers=at(moment)
    ).json()
    finish(client, session, at(moment), ratings)
    client.post(f"/api/sessions/{session['id']}/complete", headers=at(moment))


def knowledge(client: TestClient, moment: datetime = LATER) -> dict[str, Any]:
    report: dict[str, Any] = client.get("/api/progress/decks", headers=at(moment)).json()
    return report


def today(client: TestClient, moment: datetime) -> dict[str, Any]:
    report: dict[str, Any] = client.get("/api/progress", headers=at(moment)).json()["today"]
    return report


def test_learned_means_recalled_in_a_later_review(client: TestClient) -> None:
    deck = own_deck(client, ["ticket", "luggage", "passport"])
    study(client, deck["id"], DAY0)
    met = knowledge(client, DAY0)
    (row,) = met["decks"]
    # Met today, not learned yet: memory shows only in a later review.
    assert (row["word_count"], row["met"], row["learned"], row["known"]) == (3, 3, 0, 0)
    assert (row["is_mine"], row["kind"]) == (True, "user")
    # Ten days on: two recalled, one forgotten («Снова» is not learned).
    study(client, deck["id"], LATER, {"passport": 1})
    report = knowledge(client)
    (row,) = report["decks"]
    assert (row["met"], row["learned"]) == (3, 2)
    # Both recalled this week (ADR 0034); a week later they are no longer this week's.
    assert report["learned_this_week"] == 2
    assert knowledge(client, LATER + timedelta(days=7))["learned_this_week"] == 0


def test_decks_appear_once_started_and_totals_count_a_word_once(
    client: TestClient, play: Play
) -> None:
    assert knowledge(client, DAY0)["decks"] == []  # nothing started: no rows
    # A deck of my own with words but none met yet waits in «Мои колоды», not here.
    own_deck(client, ["luggage", "passport"])
    assert knowledge(client, DAY0)["decks"] == []
    # «money» is a course word: in my deck it is the course's word, one word in both.
    deck = own_deck(client, ["money", "ticket"])
    study(client, deck["id"], DAY0)
    report = knowledge(client, DAY0)
    # Only the deck studied: meeting «money» there doesn't start the course's first level.
    assert [row["title"] for row in report["decks"]] == ["Путешествия"]
    assert report["met"] == 2  # money and ticket
    # Studying the level itself starts it.
    study(client, "a1-a2", DAY0)
    report = knowledge(client, DAY0)
    assert sorted(row["title"] for row in report["decks"]) == ["Основа", "Путешествия"]


def test_a_finished_lesson_keeps_the_day_with_reviews_left_in_another_deck(
    client: TestClient, play: Play
) -> None:
    deck = own_deck(client, ["ticket", "luggage"])
    study(client, deck["id"], DAY0)
    study(client, "a1-a2", DAY0)
    # Ten days on, both decks have reviews due; the course's lesson alone keeps the day (ADR 0027).
    study(client, "a1-a2", LATER)
    assert today(client, LATER)["studied"]
