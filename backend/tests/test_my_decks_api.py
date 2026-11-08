"""Personal decks and «Мои колоды» (ADR 0019): anyone writes decks, studies them only by opening
them, fills cards from a word with AI, and finds decks given to their groups."""

from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.decks import get_provider
from app.models import DeckWord, UserWordProgress
from app.services.generation import DraftCard
from tests.support import at, cards, finish, named

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
        "/api/groups", json={"name": "7Б английский"}, headers=named(client, as_("olga"), "Ольга")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}", headers=named(client, as_("pavel"), "Павел")
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


MONEY = {"headword": "money", "pos": "noun", "translation": "деньги", "example": "No money."}


def progress_on(db: Session, user_id_words: list[str]) -> list[str]:
    return list(
        db.scalars(
            select(UserWordProgress.word_id).where(UserWordProgress.word_id.in_(user_id_words))
        )
    )


def test_deleting_a_deck_takes_its_cards_and_their_progress(
    client: TestClient, db: Session
) -> None:
    group = client.post(
        "/api/groups", json={"name": "7Б английский"}, headers=named(client, as_("olga"), "Ольга")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}", headers=named(client, as_("pavel"), "Павел")
    )
    deck = personal_deck(client, "olga", "Unit 4")
    add(client, deck, KETTLE, "olga")
    deck = add(client, deck, MONEY, "olga")  # a course word: linked, not the deck's own
    teapot = next(w["word"]["id"] for w in deck["words"] if not w["from_course"])
    client.post(
        f"/api/decks/{deck['id']}/publish", json={"group_id": group["id"]}, headers=as_("olga")
    )
    # Pavel learns it and leaves today's spelling half done: it shows the deck's word.
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck["id"]}, headers=as_("pavel")
    ).json()
    finish(client, session, as_("pavel"))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_("pavel"))
    client.post(
        "/api/sessions", json={"kind": "spelling", "deck_id": deck["id"]}, headers=as_("pavel")
    )

    # Only its author deletes it.
    for user in ("pavel", "stranger"):
        refused = client.delete(f"/api/decks/{deck['id']}", headers=as_(user))
        assert refused.status_code == 404, user
    assert client.delete(f"/api/decks/{deck['id']}", headers=as_("olga")).status_code == 204

    assert client.get(f"/api/decks/{deck['id']}/edit", headers=as_("olga")).status_code == 404
    assert client.get("/api/decks/library", headers=as_("pavel")).json()["from_groups"] == []
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    assert board["assignments"] == []
    # Its own card and the progress on it are gone; the course word stays everyone's.
    assert progress_on(db, [teapot]) == []
    assert progress_on(db, ["money"]) == ["money"]
    # The unfinished spelling that showed its card is gone too; the next one starts cleanly.
    assert client.get("/api/sessions/active", headers=as_("pavel")).json()["session"] is None
    gone = {"kind": "spelling", "deck_id": deck["id"]}
    assert client.post("/api/sessions", json=gone, headers=as_("pavel")).status_code == 404
    # Money is still Pavel's, spelled from the course level it belongs to.
    level = db.scalar(select(DeckWord.deck_id).where(DeckWord.word_id == "money"))
    spelling = client.post(
        "/api/sessions", json={"kind": "spelling", "deck_id": level}, headers=as_("pavel")
    ).json()
    assert spelling["kind"] == "spelling" and len(spelling["exercises"]) == 1  # money
    assert client.delete(f"/api/decks/{deck['id']}", headers=as_("olga")).status_code == 404


def test_a_topic_becomes_cards_for_it(client: TestClient) -> None:
    deck = personal_deck(client)
    url = f"/api/decks/{deck['id']}/words/topic"
    first = client.post(
        url, json={"topic": "в аэропорту", "count": 5, "level": "A2"}, headers=as_("pavel")
    ).json()
    assert (first["provider"], first["added"]) == ("demo", 5)
    taken = [w["word"]["headword"] for w in first["deck"]["words"]]
    # Asked again, it chooses words the deck doesn't have yet.
    second = client.post(
        url, json={"topic": "в аэропорту", "count": 5}, headers=as_("pavel")
    ).json()
    again = [w["word"]["headword"] for w in second["deck"]["words"]][5:]
    assert len(again) == 5 and not set(again) & set(taken)

    assert client.post(url, json={"topic": "x"}, headers=as_("pavel")).status_code == 422
    assert (
        client.post(url, json={"topic": "еда", "count": 7}, headers=as_("pavel")).status_code == 422
    )
    assert client.post(url, json={"topic": "еда"}, headers=as_("ivan")).status_code == 404


class TopicScript:
    """Answers topic calls from a script, repeating itself as a model sometimes does."""

    name = "deepseek"

    def __init__(self, *rounds: list[str]) -> None:
        self.rounds = list(rounds)
        self.calls: list[dict[str, Any]] = []

    def topic(
        self, topic: str, count: int, level: str, avoid: list[str], language: str = "ru"
    ) -> list[Any]:
        self.calls.append({"count": count, "avoid": list(avoid)})
        words = self.rounds.pop(0) if self.rounds else []
        return [
            DraftCard(
                headword=word, pos="noun", translation="перевод", example=f"A {word}.",
                example_translation="", source_sentence="",
            )
            for word in words
        ]  # fmt: skip


def scripted(client: TestClient, script: TopicScript) -> None:
    app = client.app
    assert hasattr(app, "dependency_overrides")
    app.dependency_overrides[get_provider] = lambda: script


def test_a_topic_never_brings_a_word_the_deck_has_had(client: TestClient) -> None:
    deck = add(
        client,
        personal_deck(client),
        {**APPLE, "headword": "flood", "translation": "наводнение", "example": "A flood."},
    )
    deck = add(
        client,
        deck,
        {**APPLE, "headword": "glacier", "translation": "ледник", "example": "A glacier."},
    )
    glacier = next(w["word"]["id"] for w in deck["words"] if w["word"]["headword"] == "glacier")
    client.delete(
        f"/api/decks/{deck['id']}/words/{glacier}", headers=as_("pavel")
    )  # out, not forgotten
    script = TopicScript(
        ["floods", "Glaciers", "drought", "heatwave", "Drought", "check-in"],
        ["check in", "wildfire", "smog", "emission"],
    )
    scripted(client, script)
    result = client.post(
        f"/api/decks/{deck['id']}/words/topic",
        json={"topic": "климат", "count": 5},
        headers=as_("pavel"),
    ).json()

    words = [w["word"]["headword"] for w in result["deck"]["words"]]
    assert words == ["flood", "drought", "heatwave", "check-in", "wildfire", "smog"]
    assert (result["added"], result["skipped"]) == (5, [])  # filled: repeats aren't reported
    # The AI is told what to avoid, the removed word included; asked for a few spare.
    first, second = script.calls
    assert set(first["avoid"]) == {"flood", "glacier"} and first["count"] == 8
    # Short after the first call: once more, with its repeats added to the list, for the rest.
    assert {"floods", "Glaciers", "Drought"} <= set(second["avoid"]) and second["count"] == 5


def test_a_topic_that_keeps_repeating_stops_after_two_calls(client: TestClient) -> None:
    deck = add(
        client,
        personal_deck(client),
        {**APPLE, "headword": "flood", "translation": "наводнение", "example": "A flood."},
    )
    script = TopicScript(["floods", "smog"], ["flooding", "Floods", "smog"], ["never asked"])
    scripted(client, script)
    result = client.post(
        f"/api/decks/{deck['id']}/words/topic",
        json={"topic": "климат", "count": 5},
        headers=as_("pavel"),
    ).json()
    assert len(script.calls) == 2  # never a third call
    # Two new words in two calls («flooding» is a word of its own, not a form of «flood»).
    added = [w["word"]["headword"] for w in result["deck"]["words"]][1:]
    assert (result["added"], added) == (2, ["smog", "flooding"])
    # Short of what was asked: the repeats are named, so the learner knows why.
    assert {(s["headword"], s["reason"]) for s in result["skipped"]} == {
        ("floods", "duplicate"),
        ("smog", "duplicate"),
    }


def test_a_word_named_on_purpose_may_come_back(client: TestClient) -> None:
    deck = add(client, personal_deck(client), KETTLE)
    teapot = deck["words"][0]["word"]["id"]
    client.delete(f"/api/decks/{deck['id']}/words/{teapot}", headers=as_("pavel"))
    filled = client.post(
        f"/api/decks/{deck['id']}/words/fill", json={"words": ["teapot"]}, headers=as_("pavel")
    ).json()
    assert filled["added"] == 1


def test_a_deck_remembers_its_topics_latest_first(client: TestClient) -> None:
    deck = personal_deck(client)
    url = f"/api/decks/{deck['id']}/words/topic"
    for minute, topic in ((1, "климат"), (2, "технологии"), (3, "Климат")):
        headers = as_("pavel", MOMENT.replace(minute=minute))
        client.post(url, json={"topic": topic, "count": 5}, headers=headers)
    edit = client.get(f"/api/decks/{deck['id']}/edit", headers=as_("pavel")).json()
    # «Климат» is «климат» again (case doesn't make a new topic): used last, written as last.
    assert edit["topics"] == ["Климат", "технологии"]
