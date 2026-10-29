"""Personal decks and «Мои колоды» (ADR 0019): anyone writes decks, studies them only by opening
them, fills cards from a word with AI, and finds decks given to their groups."""

from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UserWordProgress
from tests.support import at, cards, finish

MOMENT = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
APPLE = {"headword": "apple", "pos": "noun", "translation": "яблоко", "example": "An apple a day."}
KETTLE = {"headword": "teapot", "pos": "noun", "translation": "чайник", "example": "A teapot."}


def as_(name: str, moment: datetime = MOMENT) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


def personal_deck(
    client: TestClient, user: str = "pavel", title: str = "Мои слова", minute: int = 0
) -> Any:
    headers = as_(user, MOMENT.replace(minute=minute))
    response = client.post("/api/decks", json={"title": title}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def add(client: TestClient, deck: dict[str, Any], word: dict[str, str], user: str = "pavel") -> Any:
    response = client.post(f"/api/decks/{deck['id']}/words", json=word, headers=as_(user))
    assert response.status_code == 201, response.text
    return response.json()


def test_anyone_writes_a_deck_and_studies_it_by_opening_it(client: TestClient) -> None:
    deck = personal_deck(client)
    add(client, deck, KETTLE)
    assert deck["status"] == "draft" and deck["groups"] == []
    # Studied from the deck itself, no publishing needed.
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck["id"]}, headers=as_("pavel")
    ).json()
    assert [card["word"]["headword"] for card in cards(session) if card["new"]] == ["teapot"]
    finish(client, session, as_("pavel"))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_("pavel"))
    # The daily lesson («Продолжить») is unchanged: the course's next words, not the deck's.
    lesson = client.post("/api/sessions", json={"kind": "study"}, headers=as_("pavel")).json()
    new = [card["word"]["headword"] for card in cards(lesson) if card["new"]]
    assert "teapot" not in new and new[0] == "house"
    # Not on home (course levels only), and nobody else's.
    home = client.get("/api/decks", headers=as_("pavel")).json()
    assert deck["id"] not in [d["id"] for d in home]
    for path in (f"/api/decks/{deck['id']}/words", f"/api/decks/{deck['id']}/edit"):
        assert client.get(path, headers=as_("ivan")).status_code == 404
    stranger = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck["id"]}, headers=as_("ivan")
    )
    assert stranger.status_code == 404


def test_the_library_lists_my_decks_and_my_groups_decks(client: TestClient) -> None:
    group = client.post(
        "/api/groups", json={"name": "7Б английский", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}", json={"nickname": "Павел"}, headers=as_("pavel")
    )
    given = personal_deck(client, "olga", "Unit 4")
    add(client, given, KETTLE, "olga")
    client.post(
        f"/api/decks/{given['id']}/publish", json={"group_id": group["id"]}, headers=as_("olga")
    )
    older = personal_deck(client, "pavel", "Еда")
    add(client, older, APPLE)
    newer = personal_deck(client, "pavel", "Пусто", minute=5)

    library = client.get("/api/decks/library", headers=as_("pavel")).json()
    assert [d["title"] for d in library["mine"]] == ["Пусто", "Еда"]
    food = library["mine"][1]
    assert (food["word_count"], food["introduced_count"], food["new_today"]) == (1, 0, 1)
    (theirs,) = library["from_groups"]
    assert (theirs["title"], theirs["author"], theirs["group_name"]) == (
        "Unit 4",
        "Ольга",
        "7Б английский",
    )
    # The author finds a deck she shared under her own, with the group it went to.
    hers = client.get("/api/decks/library", headers=as_("olga")).json()
    assert hers["from_groups"] == []
    assert [g["name"] for g in hers["mine"][0]["groups"]] == ["7Б английский"]
    assert newer["id"] != older["id"]


def test_a_word_named_becomes_a_full_card(client: TestClient) -> None:
    deck = personal_deck(client)
    filled = client.post(
        f"/api/decks/{deck['id']}/words/fill",
        json={"words": ["Reluctant", "carry out", "reluctant", "money", "not valid!"]},
        headers=as_("pavel"),
    ).json()
    assert filled["provider"] == "demo"
    words = {w["word"]["headword"]: w for w in filled["deck"]["words"]}
    # Named twice («Reluctant», «reluctant»): one card. Course linking is shared with drafting
    # from text and tested there.
    assert list(words) == ["reluctant", "carry out", "money"]
    assert words["reluctant"]["word"]["translation"].endswith("(демо)")
    assert {(s["headword"], s["reason"]) for s in filled["skipped"]} == {("not valid!", "invalid")}


def test_a_suggestion_fills_the_form_and_saves_nothing(client: TestClient) -> None:
    deck = personal_deck(client)
    url = f"/api/decks/{deck['id']}/words/suggest"
    card = client.post(url, json={"headword": "Teapot"}, headers=as_("pavel")).json()
    assert (card["headword"], card["provider"]) == ("teapot", "demo")
    assert card["example"] and card["flags"] == []
    assert client.get(f"/api/decks/{deck['id']}/edit", headers=as_("pavel")).json()["words"] == []
    assert client.post(url, json={"headword": "x"}, headers=as_("ivan")).status_code == 404


def test_filling_is_limited_and_only_for_the_author(client: TestClient) -> None:
    deck = personal_deck(client)
    url = f"/api/decks/{deck['id']}/words/fill"
    assert client.post(url, json={"words": ["apple"]}, headers=as_("ivan")).status_code == 404
    assert client.post(url, json={"words": []}, headers=as_("pavel")).status_code == 422
    too_many = {"words": [f"word{n}" for n in range(21)]}
    assert client.post(url, json=too_many, headers=as_("pavel")).status_code == 422
    statuses = [
        client.post(url, json={"words": ["apple"]}, headers=as_("pavel")).status_code
        for _ in range(20)
    ]
    assert statuses[-1] == 429  # 2 refused above were never counted; 18 + this one's limit


def test_a_word_someone_met_stays_when_taken_out(client: TestClient, db: Session) -> None:
    deck = add(client, personal_deck(client), KETTLE)
    word_id = deck["words"][0]["word"]["id"]
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck["id"]}, headers=as_("pavel")
    ).json()
    finish(client, session, as_("pavel"))
    after = client.delete(f"/api/decks/{deck['id']}/words/{word_id}", headers=as_("pavel"))
    assert after.status_code == 200 and after.json()["words"] == []
    kept = db.scalars(select(UserWordProgress.word_id).where(UserWordProgress.word_id == word_id))
    assert list(kept) == [word_id]  # still reviewed
