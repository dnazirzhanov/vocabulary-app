"""Tap a word in a question (ADR 0091): a Writing or Speaking question's words glossed once per
card language and kept; only the app's own questions; a model failure is said, not hidden."""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.api.decks import get_provider
from app.core.errors import ApiError
from app.services.generation import DemoProvider, Gloss, Glossary
from tests.support import at

MOMENT = datetime(2026, 11, 25, 10, 0, tzinfo=UTC)


def as_(name: str = "anna") -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


class CountingProvider(DemoProvider):
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def gloss(self, text: str, forms: list[str], language: str, questions: int = 0) -> Glossary:
        self.calls.append((text, language))
        known = {
            "cooking": Gloss(lemma="cook", pos="verb", meaning="готовить", explanation="make food")
        }
        return Glossary(
            level="B1",
            forms={f: known.get(f, Gloss(lemma=f, pos="other", meaning=f"«{f}»")) for f in forms},
        )


class BrokenProvider(DemoProvider):
    def gloss(self, text: str, forms: list[str], language: str, questions: int = 0) -> Glossary:
        raise ApiError(502, "generation_failed", "The drafting service did not answer")


@pytest.fixture
def provider(client: TestClient) -> Iterator[CountingProvider]:
    made = CountingProvider()
    client.app.dependency_overrides[get_provider] = lambda: made  # type: ignore[attr-defined]
    yield made
    del client.app.dependency_overrides[get_provider]  # type: ignore[attr-defined]


def test_a_writing_questions_words_are_glossed_once_and_kept(
    client: TestClient, provider: CountingProvider
) -> None:
    url = "/api/prompt-glossary/writing/ielts-life-1"
    got = client.get(url, headers=as_()).json()["glossary"]
    assert got["cooking"] == {"l": "cook", "p": "verb", "t": "готовить", "d": "make food"}
    assert "ready-made" in got or "ready" in got  # every word of the prompt
    # Another learner, same language: from what was kept, no second call.
    assert client.get(url, headers=as_("boris")).json()["glossary"] == got
    assert len(provider.calls) == 1 and provider.calls[0][0].startswith("Some people believe")


def test_a_speaking_question_including_the_sentence_to_read(
    client: TestClient, provider: CountingProvider
) -> None:
    from app.services.speaking import questions

    spoken = next(q for q in questions.list_all() if q.reference_text)
    got = client.get(f"/api/prompt-glossary/speaking/{spoken.id}", headers=as_()).json()
    last_word = spoken.reference_text.rstrip(".").split()[-1].lower()  # type: ignore[union-attr]
    assert last_word in got["glossary"]


def test_each_card_language_has_its_own(client: TestClient, provider: CountingProvider) -> None:
    client.patch("/api/me", json={"language": "uz"}, headers=as_("dilnoza"))
    client.get("/api/prompt-glossary/writing/ielts-edu-1", headers=as_("anna"))
    client.get("/api/prompt-glossary/writing/ielts-edu-1", headers=as_("dilnoza"))
    assert [language for _, language in provider.calls] == ["ru", "uz"]


def test_only_the_apps_own_questions(client: TestClient, provider: CountingProvider) -> None:
    for url in (
        "/api/prompt-glossary/writing/no-such-question",
        "/api/prompt-glossary/speaking/no-such-question",
    ):
        assert client.get(url, headers=as_()).status_code == 404
    assert client.get("/api/prompt-glossary/essay/ielts-edu-1", headers=as_()).status_code == 422
    assert provider.calls == []


def test_a_model_failure_is_said_and_nothing_is_kept(client: TestClient) -> None:
    client.app.dependency_overrides[get_provider] = BrokenProvider  # type: ignore[attr-defined]
    try:
        failed = client.get("/api/prompt-glossary/writing/ielts-edu-2", headers=as_())
    finally:
        del client.app.dependency_overrides[get_provider]  # type: ignore[attr-defined]
    assert failed.status_code == 502
    made = CountingProvider()
    client.app.dependency_overrides[get_provider] = lambda: made  # type: ignore[attr-defined]
    try:
        assert (
            client.get("/api/prompt-glossary/writing/ielts-edu-2", headers=as_()).status_code == 200
        )
    finally:
        del client.app.dependency_overrides[get_provider]  # type: ignore[attr-defined]
    assert len(made.calls) == 1  # asked again: the failure was not kept


def _youtube(client: TestClient, who: str) -> str:
    made = client.post(
        "/api/shadowing/exercises",
        json={
            "youtube_id": "dQw4w9WgXcQ",
            "title": "Food",
            "clip_start_ms": 0,
            "clip_end_ms": 6000,
            "sentences": [
                {"start_ms": 0, "end_ms": 3000, "text": "Good morning, everyone."},
                {"start_ms": 3000, "end_ms": 6000, "text": "We are cooking today."},
            ],
        },
        headers=as_(who),
    )
    assert made.status_code == 201, made.text
    exercise_id: str = made.json()["id"]
    return exercise_id


def test_a_shadowing_sentence_is_glossed_on_its_own_once_and_kept(
    client: TestClient, provider: CountingProvider
) -> None:
    exercise = _youtube(client, "anna")
    url = f"/api/prompt-glossary/shadowing/{exercise}.1"
    got = client.get(url, headers=as_()).json()["glossary"]
    assert got["cooking"]["t"] == "готовить"
    assert set(got) == {"we", "are", "cooking", "today"}
    # Only that sentence goes to the model, and only once.
    assert provider.calls == [("We are cooking today.", "ru")]
    assert client.get(url, headers=as_()).json()["glossary"] == got
    assert len(provider.calls) == 1


def test_a_shadowing_sentence_is_glossed_only_for_who_may_open_it(
    client: TestClient, provider: CountingProvider
) -> None:
    exercise = _youtube(client, "anna")
    for url in (
        f"/api/prompt-glossary/shadowing/{exercise}.0",  # not hers
        f"/api/prompt-glossary/shadowing/{exercise}.9",
        "/api/prompt-glossary/shadowing/not-an-id.0",
    ):
        assert client.get(url, headers=as_("boris")).status_code == 404, url
    assert (
        client.get(f"/api/prompt-glossary/shadowing/{exercise}.9", headers=as_()).status_code == 404
    )
    assert provider.calls == []
