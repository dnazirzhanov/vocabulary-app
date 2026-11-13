"""Texts people add to Reading Mode, and their categories (round 2)."""

from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient

from app.api.decks import get_provider
from app.core.errors import ApiError
from app.services.generation import DemoProvider, Gloss, Glossary
from app.services.readings import paragraphs
from tests.support import at

NOW = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)
TEXT = (
    "The children went to the river.\n\n"
    "Anna’s brother found a small boat near the bank, and they sailed\n"
    "across the water."
)


def as_(user: str) -> dict[str, str]:
    return {"X-Dev-User": user} | at(NOW)


def add(client: TestClient, user: str = "anna", **fields: Any) -> Any:
    response = client.post(
        "/api/readings", json={"title": "The river", "text": TEXT} | fields, headers=as_(user)
    )
    assert response.status_code == 201, response.text
    return response.json()


class ContextProvider(DemoProvider):
    """Meanings as a model would write them, one form left out, the level guessed."""

    def __init__(self) -> None:
        self.asked: list[list[str]] = []

    def gloss(self, text: str, forms: list[str], language: str, questions: int = 0) -> Glossary:
        self.asked.append(forms)
        known = {
            "went": Gloss(lemma="go", pos="verb", meaning="пошли", explanation="moved somewhere"),
            "children": Gloss(lemma="child", pos="noun", meaning="дети"),
            "anna's": Gloss(lemma="Anna", pos="name", meaning="Анна"),
        }
        return Glossary(
            level="A2",
            forms={form: known.get(form, Gloss(lemma=form, pos="other", meaning=f"«{form}»"))
                   for form in forms if form != "river"},
        )  # fmt: skip


class BrokenProvider(DemoProvider):
    def gloss(self, text: str, forms: list[str], language: str, questions: int = 0) -> Glossary:
        raise ApiError(502, "generation_failed", "The drafting service did not answer")


def test_pasted_text_becomes_paragraphs_as_the_reader_draws_them() -> None:
    assert paragraphs(TEXT) == [
        "The children went to the river.",
        "Anna's brother found a small boat near the bank, and they sailed across the water.",
    ]
    # A word cut at a photographed line's end is joined; blank lines, however many, part paragraphs.
    assert paragraphs("an experi-\nment\n\n\n\nNext  one ") == ["an experiment", "Next one"]


def test_a_text_is_saved_at_once_and_its_meanings_follow(client: TestClient) -> None:
    provider = ContextProvider()
    client.app.dependency_overrides[get_provider] = lambda: provider  # type: ignore[attr-defined]
    try:
        made = add(client)
    finally:
        del client.app.dependency_overrides[get_provider]  # type: ignore[attr-defined]
    assert made["status"] == "drafting" and made["glossary"] == {}
    assert made["body"][0] == "The children went to the river." and made["words"] == 21

    # The meanings were written after the answer (in tests, before the next request).
    got = client.get(f"/api/readings/{made['id']}", headers=as_("anna")).json()
    assert got["status"] == "ready" and got["level"] == "A2" and got["language"] == "ru"
    assert got["glossary"]["went"] == {"l": "go", "p": "verb", "t": "пошли", "d": "moved somewhere"}
    # A name has no part of speech, so it is never offered as a card.
    assert got["glossary"]["anna's"]["p"] is None
    # A form the model left out comes from the course glossary.
    assert got["glossary"]["river"]["t"] == "река"
    # Every form of the text asked for once, in one batch, the left-out one included.
    (asked,) = provider.asked
    assert set(asked) == set(got["glossary"]) and len(asked) == len(set(asked))
    listed = client.get("/api/readings", headers=as_("anna")).json()
    assert [one["id"] for one in listed["readings"]] == [made["id"]]


def test_failed_meanings_can_be_asked_for_again(client: TestClient) -> None:
    client.app.dependency_overrides[get_provider] = lambda: BrokenProvider()  # type: ignore[attr-defined]
    try:
        made = add(client)
    finally:
        del client.app.dependency_overrides[get_provider]  # type: ignore[attr-defined]
    url = f"/api/readings/{made['id']}"
    assert client.get(url, headers=as_("anna")).json()["status"] == "failed"
    assert client.post(f"{url}/draft", headers=as_("anna")).json()["status"] == "drafting"
    assert client.get(url, headers=as_("anna")).json()["status"] == "ready"
    # Only a failed one is asked again.
    again = client.post(f"{url}/draft", headers=as_("anna"))
    assert (again.status_code, again.json()["error"]["code"]) == (409, "reading_not_failed")


def test_a_text_has_limits(client: TestClient) -> None:
    def refused(text: str) -> tuple[int, str]:
        response = client.post(
            "/api/readings", json={"title": "X", "text": text}, headers=as_("anna")
        )
        return response.status_code, response.json()["error"]["code"]

    assert refused("word " * 2001) == (422, "reading_too_long")
    assert refused("123 — 456") == (422, "reading_empty")
    assert add(client, text="word " * 2000)["words"] == 2000


def test_nobody_reaches_another_persons_texts_or_categories(client: TestClient) -> None:
    made = add(client)
    category = client.post(
        "/api/reading-categories", json={"name": "Уроки"}, headers=as_("anna")
    ).json()
    url = f"/api/readings/{made['id']}"
    assert client.get(url, headers=as_("boris")).status_code == 404
    assert client.patch(url, json={"title": "Mine"}, headers=as_("boris")).status_code == 404
    assert client.delete(url, headers=as_("boris")).status_code == 404
    assert client.get("/api/readings", headers=as_("boris")).json() == {
        "categories": [],
        "readings": [],
    }
    # Nor files a text under someone else's category.
    response = client.post(
        "/api/readings",
        json={"title": "X", "text": TEXT, "category_id": category["id"]},
        headers=as_("boris"),
    )
    assert response.status_code == 404
    assert (
        client.delete(f"/api/reading-categories/{category['id']}", headers=as_("boris")).status_code
        == 404
    )


def test_categories_hold_texts_and_deleting_one_keeps_them(client: TestClient) -> None:
    lessons = client.post(
        "/api/reading-categories", json={"name": "Уроки"}, headers=as_("anna")
    ).json()
    same = client.post("/api/reading-categories", json={"name": " уроки "}, headers=as_("anna"))
    assert (same.status_code, same.json()["error"]["code"]) == (409, "category_exists")
    made = add(client, category_id=lessons["id"])
    assert made["category_id"] == lessons["id"]

    renamed = client.patch(
        f"/api/reading-categories/{lessons['id']}", json={"name": "Домашка"}, headers=as_("anna")
    )
    assert renamed.json()["name"] == "Домашка"
    # Moved out of it, then back in, then the category goes: the text stays.
    url = f"/api/readings/{made['id']}"
    assert (
        client.patch(url, json={"category_id": None}, headers=as_("anna")).json()["category_id"]
        is None
    )
    client.patch(url, json={"category_id": lessons["id"]}, headers=as_("anna"))
    client.delete(f"/api/reading-categories/{lessons['id']}", headers=as_("anna"))
    listed = client.get("/api/readings", headers=as_("anna")).json()
    assert listed["categories"] == []
    assert [(one["id"], one["category_id"]) for one in listed["readings"]] == [(made["id"], None)]
    assert client.delete(url, headers=as_("anna")).status_code == 204
    assert client.get(url, headers=as_("anna")).status_code == 404


def test_a_text_can_be_filed_under_one_of_the_librarys_topics(client: TestClient) -> None:
    made = add(client, topic="history")
    assert (made["topic"], made["category_id"]) == ("history", None)
    listed = client.get("/api/readings", headers=as_("anna")).json()["readings"]
    assert [one["topic"] for one in listed] == ["history"]
    # A category or a topic, never both; moving to one leaves the other.
    lessons = client.post(
        "/api/reading-categories", json={"name": "Уроки"}, headers=as_("anna")
    ).json()
    both = client.post(
        "/api/readings",
        json={"title": "X", "text": TEXT, "topic": "science", "category_id": lessons["id"]},
        headers=as_("anna"),
    )
    assert both.status_code == 422
    url = f"/api/readings/{made['id']}"
    moved = client.patch(url, json={"category_id": lessons["id"]}, headers=as_("anna")).json()
    assert (moved["topic"], moved["category_id"]) == (None, lessons["id"])
    back = client.patch(url, json={"topic": "culture"}, headers=as_("anna")).json()
    assert (back["topic"], back["category_id"]) == ("culture", None)
    unknown = client.post(
        "/api/readings", json={"title": "X", "text": TEXT, "topic": "cooking"}, headers=as_("anna")
    )
    assert unknown.status_code == 422
