"""Drafting a deck from a teacher's text (ADR 0018): the draft lands in the deck for review,
course words are linked, doubtful cards are flagged and unusable ones reported, never dropped."""

from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.decks import get_provider
from app.core.config import Settings
from app.core.errors import ApiError
from app.main import create_app
from app.services.generation import DemoProvider, DraftCard, Level, Pos, flags, provider_for
from tests.support import at

MOMENT = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
TEXT = (
    "After several setbacks, the company managed to carry out the experiment. "
    "Scientists measured the pollution in the river every morning."
)


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


def draft_deck(client: TestClient) -> dict[str, Any]:
    group = client.post(
        "/api/groups", json={"name": "7Б английский", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    deck: dict[str, Any] = client.post(
        "/api/decks", json={"title": "Unit 4", "group_id": group["id"]}, headers=as_("olga")
    ).json()
    return deck


class FixedProvider:
    """Answers as a model might, mistakes included."""

    name = "claude"

    def __init__(self) -> None:
        self.asked: dict[str, Any] = {}

    def draft(self, text: str, count: int, level: Level, avoid: list[str]) -> list[DraftCard]:
        self.asked = {"count": count, "level": level, "avoid": avoid}

        def card(headword: str, translation: str, example: str, pos: Pos = "noun") -> DraftCard:
            return DraftCard(
                headword=headword,
                pos=pos,
                translation=translation,
                example=example,
                example_ru="",
                source_sentence=TEXT.split(". ")[0] + ".",
            )

        return [
            card("setback", "неудача", "The rain was a setback."),
            card(" Carry  Out ", "проводить", "They carried out the test.", "phrase"),
            card("money", "деньги", "No money."),  # a course word: linked
            card("setback", "неудача", "Again."),  # a duplicate
            card("not valid!", "нет", "Nope."),
            card("pollution", "pollution", "Air pollution is bad."),  # not Russian: flagged
        ]


@pytest.fixture
def fixed(client: TestClient) -> FixedProvider:
    provider = FixedProvider()
    app = client.app
    assert hasattr(app, "dependency_overrides")
    app.dependency_overrides[get_provider] = lambda: provider
    return provider


def test_demo_drafts_cards_from_the_text_itself(client: TestClient) -> None:
    deck = draft_deck(client)
    result = client.post(
        f"/api/decks/{deck['id']}/generate", json={"text": TEXT, "count": 5}, headers=as_("olga")
    ).json()
    assert result["provider"] == "demo" and result["added"] == 5
    words = result["deck"]["words"]
    # Long lowercase words of the text, in order: a stand-in for a model's choice.
    assert [w["word"]["headword"] for w in words] == [
        "several", "setbacks", "company", "managed", "experiment",
    ]  # fmt: skip
    assert words[0]["source_sentence"].startswith("After several setbacks")
    assert result["deck"]["status"] == "draft"  # reviewed before it is given


def test_a_draft_is_checked_and_problems_are_reported(
    client: TestClient, fixed: FixedProvider
) -> None:
    deck = draft_deck(client)
    result = client.post(
        f"/api/decks/{deck['id']}/generate",
        json={"text": TEXT, "count": 10, "level": "A2"},
        headers=as_("olga"),
    ).json()
    assert fixed.asked == {"count": 10, "level": "A2", "avoid": []}
    words = {w["word"]["headword"]: w for w in result["deck"]["words"]}
    assert list(words) == ["setback", "carry out", "money", "pollution"]
    assert words["money"]["from_course"] and words["money"]["word"]["id"] == "money"
    assert words["carry out"]["flags"] == []  # "carried out" uses the phrase
    assert words["pollution"]["flags"] == ["translation_not_russian"]
    assert {(s["headword"], s["reason"]) for s in result["skipped"]} == {
        ("setback", "duplicate"),
        ("not valid!", "invalid"),
    }
    # A second draft knows what the deck already holds.
    client.post(f"/api/decks/{deck['id']}/generate", json={"text": TEXT}, headers=as_("olga"))
    assert set(fixed.asked["avoid"]) == {"setback", "carry out", "money", "pollution"}


def test_only_the_author_drafts_and_the_text_has_limits(client: TestClient) -> None:
    deck = draft_deck(client)
    url = f"/api/decks/{deck['id']}/generate"
    assert client.post(url, json={"text": TEXT}, headers=as_("pavel")).status_code == 404
    assert client.post(url, json={"text": "too short"}, headers=as_("olga")).status_code == 422
    assert client.post(url, json={"text": TEXT, "count": 7}, headers=as_("olga")).status_code == 422
    too_long = {"text": "word " * 4001}
    assert client.post(url, json=too_long, headers=as_("olga")).status_code == 422


def test_drafts_are_limited_per_day(client: TestClient) -> None:
    deck = draft_deck(client)
    url = f"/api/decks/{deck['id']}/generate"
    responses = [
        client.post(url, json={"text": TEXT, "count": 5}, headers=as_("olga")) for _ in range(21)
    ]
    assert [r.status_code for r in responses[-2:]] == [200, 429]
    assert responses[-1].json()["error"]["code"] == "generation_limit"


def settings(**values: Any) -> Settings:
    # Explicit values win over the environment and .env, so a developer's own key changes nothing.
    values = {"anthropic_api_key": None, "generation_provider": "auto"} | values
    return Settings(database_url="postgresql+psycopg://localhost/x", **values)


def test_which_provider_drafts() -> None:
    assert isinstance(provider_for(settings()), DemoProvider)
    assert provider_for(settings(anthropic_api_key="k")).name == "claude"
    assert isinstance(
        provider_for(settings(generation_provider="demo", anthropic_api_key="k")), DemoProvider
    )
    production = {
        "environment": "production",
        "auth_mode": "jwt",
        "auth_issuer": "https://x.supabase.co/auth/v1",
    }
    with pytest.raises(ApiError) as missing:
        provider_for(settings(**production))
    assert missing.value.status == 503


def test_flags_point_at_what_to_check() -> None:
    assert flags("carry out", "проводить", "They carried out the test.") == []
    assert flags("manage to", "суметь", "She managed to finish.") == []
    assert flags("setback", "setback", "No word here.") == [
        "translation_not_russian",
        "example_without_word",
    ]
    assert "example_long" in flags("x", "икс", "x " * 90)


def test_the_app_starts_without_a_key() -> None:
    assert create_app() is not None
