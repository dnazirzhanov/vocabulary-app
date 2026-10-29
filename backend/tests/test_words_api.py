"""The word list: every deck word in order, with the learner's own status."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tests.support import Play, at

DAY_1 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
NEW = {"kind": "new", "deck_id": "starter"}
REVIEW = {"kind": "review", "deck_id": "starter"}


def statuses(client: TestClient, moment: datetime) -> dict[str, str]:
    rows = client.get("/api/decks/starter/words", headers=at(moment)).json()
    return {row["word"]["id"]: row["status"] for row in rows}


def test_every_word_is_listed_in_deck_order_with_nothing_hidden(client: TestClient) -> None:
    rows = client.get("/api/decks/starter/words").json()
    assert len(rows) == 30
    assert [row["position"] for row in rows] == list(range(30))
    assert rows[0]["word"]["headword"] == "house"
    assert rows[0]["word"]["translation"]  # translations are visible before learning
    assert {row["status"] for row in rows} == {"not_started"}
    assert rows[0]["next_review_at"] is None


def test_status_follows_learning(client: TestClient, play: Play) -> None:
    play(NEW, DAY_1)
    after_lesson = statuses(client, DAY_1)
    assert [after_lesson[w] for w in ("house", "water", "city")] == ["new", "new", "not_started"]

    play(REVIEW, DAY_1 + timedelta(days=1, hours=1))
    assert statuses(client, DAY_1 + timedelta(days=1, hours=2))["house"] == "learning"


def test_another_learner_sees_only_their_own_status(client: TestClient, play: Play) -> None:
    play(NEW, DAY_1)
    other = client.get("/api/decks/starter/words", headers={"X-Dev-User": "someone-else"}).json()
    assert {row["status"] for row in other} == {"not_started"}


def test_unknown_deck_is_404(client: TestClient) -> None:
    assert client.get("/api/decks/nope/words").status_code == 404
