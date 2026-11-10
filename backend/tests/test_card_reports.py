"""A learner says a card is wrong (from a lesson or the word list, offline too): a course card's
reports reach the content editors only, a deck's own card's its author, and correcting the card
closes them."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from tests.support import at

NOW = datetime(2026, 11, 10, 9, 0, tzinfo=UTC)


def as_(user: str) -> dict[str, str]:
    return {"X-Dev-User": user} | at(NOW)


@pytest.fixture(autouse=True)
def owner_reads_course_reports(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "content_editors", "dev|owner, ")


def report(client: TestClient, user: str, deck: str, word: str, **fields: Any) -> int:
    body = {"deck_id": deck, "word_id": word, "reason": "translation"} | fields
    return client.post("/api/card-reports", json=body, headers=as_(user)).status_code


def course_word(client: TestClient) -> str:
    words = client.get("/api/decks/a1-a2/words", headers=as_("pavel")).json()
    return str(words[0]["word"]["id"])


def test_a_course_card_reported_reaches_only_the_content_editors(client: TestClient) -> None:
    word = course_word(client)
    assert report(client, "pavel", "a1-a2", word, note="  неверный   перевод ") == 204
    # Reported again: the same report, with the new reason and note.
    assert report(client, "pavel", "a1-a2", word, reason="example", note="пример") == 204
    assert report(client, "anna", "a1-a2", word) == 204

    assert client.get("/api/card-reports", headers=as_("pavel")).status_code == 403
    assert client.get("/api/me", headers=as_("owner")).json()["content_editor"] is True
    assert client.get("/api/me", headers=as_("pavel")).json()["content_editor"] is False
    (card,) = client.get("/api/card-reports", headers=as_("owner")).json()["cards"]
    assert (card["word_id"], card["translation_wrong"], card["example_wrong"]) == (word, 1, 1)
    assert card["notes"] == ["пример"]

    # Done: the list is empty; a new report opens it again.
    assert client.post(f"/api/card-reports/{word}/resolve", headers=as_("pavel")).status_code == 404
    assert client.post(f"/api/card-reports/{word}/resolve", headers=as_("owner")).status_code == 204
    assert client.get("/api/card-reports", headers=as_("owner")).json()["cards"] == []


def test_a_deck_s_own_card_goes_to_its_author_and_correcting_it_closes_the_reports(
    client: TestClient,
) -> None:
    client.patch("/api/me", json={"name": "Ольга"}, headers=as_("olga"))
    client.patch("/api/me", json={"name": "Павел"}, headers=as_("pavel"))
    group = client.post("/api/groups", json={"name": "Класс"}, headers=as_("olga")).json()
    client.post(f"/api/groups/join/{group['invite_code']}", headers=as_("pavel"))
    deck = client.post("/api/decks", json={"title": "Unit 1"}, headers=as_("olga")).json()
    card = {"headword": "quill", "pos": "noun", "translation": "ложка", "example": "A quill."}
    deck = client.post(f"/api/decks/{deck['id']}/words", json=card, headers=as_("olga")).json()
    word = deck["words"][0]["word"]["id"]
    # Not given yet: Pavel can't see it, so can't report it.
    assert report(client, "pavel", deck["id"], word) == 404
    client.post(
        f"/api/decks/{deck['id']}/publish", json={"group_id": group["id"]}, headers=as_("olga")
    )
    assert report(client, "pavel", deck["id"], word, note="quill — перо") == 204

    listed = client.get(f"/api/decks/{deck['id']}/card-reports", headers=as_("olga")).json()
    assert [(c["headword"], c["notes"]) for c in listed["cards"]] == [("quill", ["quill — перо"])]
    assert (
        client.get(f"/api/decks/{deck['id']}/card-reports", headers=as_("pavel")).status_code == 404
    )
    # Not a course card: the content editors don't get it.
    assert client.get("/api/card-reports", headers=as_("owner")).json()["cards"] == []

    # The author corrects it: the report is closed.
    client.put(
        f"/api/decks/{deck['id']}/words/{word}",
        json=card | {"translation": "перо"},
        headers=as_("olga"),
    )
    assert client.get(f"/api/decks/{deck['id']}/card-reports", headers=as_("olga")).json() == {
        "cards": []
    }


def test_reported_offline_it_arrives_with_the_other_changes(client: TestClient) -> None:
    word = course_word(client)
    op = {
        "op_id": str(uuid4()),
        "kind": "card.report",
        "deck_id": "a1-a2",
        "word_id": word,
        "reason": "other",
        "note": "опечатка",
        "reported_at": NOW.isoformat(),
    }
    response = client.post(
        "/api/sync/push", json={"ops": [op], "pulled_at": NOW.isoformat()}, headers=as_("pavel")
    )
    assert response.json()["results"][0]["status"] == "applied"
    (card,) = client.get("/api/card-reports", headers=as_("owner")).json()["cards"]
    assert (card["other"], card["notes"]) == (1, ["опечатка"])


def test_at_most_thirty_reports_a_day(client: TestClient) -> None:
    words = client.get("/api/decks/a1-a2/words", headers=as_("pavel")).json()
    codes = [report(client, "pavel", "a1-a2", row["word"]["id"]) for row in words[:31]]
    assert codes == [204] * 30 + [429]
