"""Learning English in your own language (ADR 0055): what's Russian must not reach someone who
chose another language, and each trap below once did or would have."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Deck
from app.services.generation import _LANGUAGES, flags, prompt_for


def choose(client: TestClient, **changes: str) -> dict[str, Any]:
    response = client.patch("/api/me", json={"daily_target_words": 5, **changes})
    assert response.status_code == 200, response.text
    me: dict[str, Any] = response.json()
    return me


def a_course(db: Session) -> str:
    deck = db.scalars(select(Deck).where(Deck.kind == "course")).first()
    assert deck is not None, "the tests' database holds the course"
    return deck.id


def test_the_two_languages_are_separate_choices(client: TestClient) -> None:
    me = choose(client, language="ky", ui_language="en")
    assert (me["language"], me["ui_language"]) == ("ky", "en")
    refused = client.patch("/api/me", json={"language": "en"})
    assert refused.status_code == 422  # English is what's learned, never the translation


@pytest.mark.parametrize("language", ["uz", "kk", "ky", "tg"])
def test_the_course_is_closed_outside_russian_on_every_path(
    client: TestClient, db: Session, language: str
) -> None:
    course = a_course(db)
    assert client.get("/api/decks").json()  # open while not yet asked
    choose(client, language=language)
    assert client.get("/api/decks").json() == []
    assert client.get(f"/api/decks/{course}/stats").status_code == 404
    assert client.get(f"/api/decks/{course}/words").status_code == 404
    started = client.post("/api/sessions", json={"kind": "study", "deck_id": course})
    assert started.status_code == 404
    home = client.get("/api/decks/library").json()
    assert all(deck["kind"] != "course" for deck in home["mine"] + home["from_groups"])
    words_left = client.get("/api/progress/decks").json()
    assert all(deck["kind"] != "course" for deck in words_left["decks"])


def test_switching_back_to_russian_brings_the_course_back(client: TestClient, db: Session) -> None:
    course = a_course(db)
    choose(client, language="ky")
    assert client.get("/api/decks").json() == []
    choose(client, language="ru")
    assert client.get(f"/api/decks/{course}/stats").status_code == 200


def test_a_new_deck_takes_my_language_or_the_one_named(client: TestClient) -> None:
    choose(client, language="kk")
    mine = client.post("/api/decks", json={"title": "Жол"}).json()
    assert mine["language"] == "kk"
    named = client.post("/api/decks", json={"title": "Жол", "language": "tg"}).json()
    assert named["language"] == "tg"


def test_a_decks_language_changes_only_while_it_has_no_words(client: TestClient) -> None:
    choose(client, language="ky")
    deck = client.post("/api/decks", json={"title": "Жол"}).json()
    url = f"/api/decks/{deck['id']}"
    assert client.put(f"{url}/language", json={"language": "uz"}).json()["language"] == "uz"
    word = {"headword": "road", "pos": "noun", "translation": "yo‘l", "example": "A long road."}
    assert client.post(f"{url}/words", json=word).status_code < 300
    refused = client.put(f"{url}/language", json={"language": "kk"})
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "deck_has_words")


def test_a_word_the_course_also_has_keeps_this_decks_own_meaning(
    client: TestClient, db: Session
) -> None:
    """The trap: `house` would have linked the course's word, with its Russian meaning."""
    choose(client, language="ky")
    deck = client.post("/api/decks", json={"title": "Үй"}).json()
    word = {"headword": "house", "pos": "noun", "translation": "үй", "example": "A small house."}
    added = client.post(f"/api/decks/{deck['id']}/words", json=word).json()
    (card,) = added["words"]
    assert (card["word"]["translation"], card["from_course"]) == ("үй", False)

    choose(client, language="ru")
    russian = client.post("/api/decks", json={"title": "Дом"}).json()
    word = {**word, "translation": "дом"}
    linked = client.post(f"/api/decks/{russian['id']}/words", json=word).json()
    assert linked["words"][0]["from_course"] is True  # still saves learning it twice in Russian


def test_tapping_a_word_is_offered_only_where_the_glossary_is_in_the_decks_language(
    client: TestClient, db: Session
) -> None:
    course = client.post("/api/sessions", json={"kind": "study", "deck_id": a_course(db)}).json()
    assert course["glossary"] is True
    client.post(f"/api/sessions/{course['id']}/complete")
    choose(client, language="ky")
    deck = client.post("/api/decks", json={"title": "Жол"}).json()
    word = {"headword": "road", "pos": "noun", "translation": "жол", "example": "A long road."}
    client.post(f"/api/decks/{deck['id']}/words", json=word)
    own = client.post("/api/sessions", json={"kind": "study", "deck_id": deck["id"]}).json()
    assert own["glossary"] is False


@pytest.mark.parametrize(
    ("language", "translation", "example", "flagged"),
    [
        ("ky", "жол", "Узун жол.", False),
        ("ky", "дорога, путь", "Это очень длинная дорога через горы.", True),  # came back Russian
        ("kk", "дорога, путь", "Это очень длинная дорога через горы.", True),
        ("tg", "дорога, путь", "Это очень длинная дорога через горы.", True),
        ("tg", "роҳ", "Роҳи дароз.", False),
        ("kk", "жол", "Ұзақ жол.", False),
        ("uz", "yo‘l", "Uzun yo‘l.", False),
        ("uz", "дорога", "", True),
        ("ru", "дорога", "Длинная дорога.", False),
        ("ru", "road", "", True),
        ("ky", "road", "", True),  # the headword copied back
    ],
)
def test_a_card_in_the_wrong_language_is_flagged(
    language: str, translation: str, example: str, flagged: bool
) -> None:
    found = flags("road", translation, "A long road.", language, example)
    assert ("translation_wrong_language" in found) == flagged


@pytest.mark.parametrize("kind", ["draft", "fill", "topic"])
@pytest.mark.parametrize("language", list(_LANGUAGES))
def test_each_prompt_is_wholly_in_the_decks_language(kind: str, language: str) -> None:
    from app.services import generation

    template = {"draft": generation.SYSTEM, "fill": generation.FILL, "topic": generation.TOPIC}[
        kind
    ]
    prompt = prompt_for(template, kind, language)
    name, _, cards = _LANGUAGES[language]
    assert name in prompt and "{" + "LANGUAGE" not in prompt and "{EXAMPLE}" not in prompt
    assert "{SCRIPT}" not in prompt
    assert cards[kind][0] in prompt
    # The trap: a Russian example card pulls the model's answer to Russian.
    if language != "ru":
        assert "Russian-speaking" not in prompt
        for other in _LANGUAGES["ru"][2].values():
            assert other[0] not in prompt
