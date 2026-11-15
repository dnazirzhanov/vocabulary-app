"""Mentor chat endpoint: tester gate, demo reply, rate limit, message persistence."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.ratelimit import reset_limits
from app.models import User
from app.services.mentor import _system_prompt
from tests.support import at

MOMENT = datetime(2026, 11, 14, 10, 0, tzinfo=UTC)


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


def _enable_mentor(monkeypatch: pytest.MonkeyPatch, pattern: str = "*") -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", pattern)


def test_chat_is_refused_without_tester_flag(client: TestClient) -> None:
    resp = client.post("/api/mentor/chat", json={"message": "Привет"}, headers=as_("alice"))
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_a_mentor_tester"


def test_chat_returns_demo_reply(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    resp = client.post("/api/mentor/chat", json={"message": "Как дела?"}, headers=as_("alice"))
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["reply"], str) and len(body["reply"]) > 0
    assert "created_at" in body


def test_chat_message_is_trimmed_and_capped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    # Exactly at the max: 500 characters.
    long_ok = "х" * 500
    resp = client.post("/api/mentor/chat", json={"message": long_ok}, headers=as_("bob"))
    assert resp.status_code == 200

    # Over the max.
    too_long = "х" * 501
    resp = client.post("/api/mentor/chat", json={"message": too_long}, headers=as_("bob"))
    assert resp.status_code == 422

    # Empty after stripping.
    resp = client.post("/api/mentor/chat", json={"message": "   "}, headers=as_("bob"))
    assert resp.status_code == 422


def test_chat_tester_gate_by_prefix(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "e2e-mentor-*")
    # Matches the prefix.
    resp = client.post(
        "/api/mentor/chat",
        json={"message": "hi"},
        headers=as_("e2e-mentor-abc123"),
    )
    assert resp.status_code == 200
    # Does not match.
    resp = client.post(
        "/api/mentor/chat",
        json={"message": "hi"},
        headers=as_("other-user"),
    )
    assert resp.status_code == 403


def test_system_prompt_includes_deck_names_when_due() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, 3, 20, 5, [("Animals", 15), ("Food", 5)])
    assert "Animals: 15 words" in prompt
    assert "Food: 5 words" in prompt
    assert "Top decks due today" in prompt


def test_system_prompt_omits_deck_section_when_no_due() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, 0, 0, 0, [])
    assert "Top decks due today" not in prompt
    # Placeholder is fully consumed — no stray {DECK_SECTION} in output.
    assert "{DECK_SECTION}" not in prompt


def test_chat_rate_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    monkeypatch.setattr(get_settings(), "mentor_chats_per_day", 2)
    reset_limits()
    for _ in range(2):
        resp = client.post("/api/mentor/chat", json={"message": "hi"}, headers=as_("carol"))
        assert resp.status_code == 200
    refused = client.post("/api/mentor/chat", json={"message": "hi"}, headers=as_("carol"))
    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "mentor_chat_limit"
    reset_limits()
