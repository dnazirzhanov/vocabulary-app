"""The word list: every deck word in order, with the learner's own status."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tests.support import Play, at

DAY_1 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
NEW = {"kind": "study", "deck_id": "a1-a2"}


def statuses(client: TestClient, moment: datetime) -> dict[str, str]:
    rows = client.get("/api/decks/a1-a2/words", headers=at(moment)).json()
    return {row["word"]["id"]: row["status"] for row in rows}


def test_every_word_is_listed_in_deck_order_with_nothing_hidden(client: TestClient) -> None:
    rows = client.get("/api/decks/a1-a2/words").json()
    assert len(rows) == 100
    assert [row["position"] for row in rows] == list(range(100))
    assert rows[0]["word"]["headword"] == "house"
    assert rows[0]["word"]["translation"]  # translations are visible before learning
    assert {row["status"] for row in rows} == {"not_started"}
    assert rows[0]["next_review_at"] is None


def test_status_follows_learning(client: TestClient, play: Play) -> None:
    session = client.post("/api/sessions", json=NEW, headers=at(DAY_1)).json()
    client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={"exercise_id": "c1", "response": {"kind": "rating", "rating": 3}},
        headers=at(DAY_1),
    )
    # Rated once: still in its learning steps.
    assert statuses(client, DAY_1)["house"] == "new"

    play(NEW, DAY_1 + timedelta(minutes=15))  # finishes the session: words graduate to review
    after = statuses(client, DAY_1)
    assert [after[w] for w in ("house", "water", "city")] == ["learning", "learning", "not_started"]


def test_another_learner_sees_only_their_own_status(client: TestClient, play: Play) -> None:
    play(NEW, DAY_1)
    other = client.get("/api/decks/a1-a2/words", headers={"X-Dev-User": "someone-else"}).json()
    assert {row["status"] for row in other} == {"not_started"}


def test_unknown_deck_is_404(client: TestClient) -> None:
    assert client.get("/api/decks/nope/words").status_code == 404


def test_the_glossary_explains_every_example_word(client: TestClient) -> None:
    glossary = client.get("/api/glossary").json()
    assert glossary["lives"] == {"ru": "живёт", "lemma": "live", "note": None}
    assert glossary["don't"]["note"] == "= do not"
