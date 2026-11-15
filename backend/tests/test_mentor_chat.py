"""Mentor chat endpoint: tester gate, demo reply, rate limit, message persistence."""

import json
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.ratelimit import reset_limits
from app.models import MentorMessage, User
from app.services.mentor import LearnerContext, _system_prompt
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


_TZ = ZoneInfo("Asia/Bishkek")


def _ctx(**kwargs: Any) -> LearnerContext:
    """Build a LearnerContext with sensible test defaults; override via kwargs."""
    defaults: dict[str, Any] = {"last_study": "today"}
    defaults.update(kwargs)
    return LearnerContext(**defaults)


def test_system_prompt_includes_deck_names_when_due() -> None:
    user = User(ui_language="en", name="Alex")
    ctx = _ctx(
        streak_weeks=3,
        sessions_today="2 (1 study, 1 spelling)",
        due_vocab=20,
        due_spelling=5,
        deck_rows=[("Animals", 15), ("Food", 5)],
    )
    prompt = _system_prompt(user, MOMENT, _TZ, ctx)
    assert "Animals: 15 words" in prompt
    assert "Food: 5 words" in prompt
    assert "Top decks due today" in prompt


def test_system_prompt_omits_deck_section_when_no_due() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "Top decks due today" not in prompt
    assert "{DECK_SECTION}" not in prompt


def test_system_prompt_includes_reading_when_engaged() -> None:
    user = User(ui_language="en", name="Alex")
    ctx = _ctx(
        streak_weeks=2, due_vocab=10, reading_total=5, reading_recent=["The Internet", "Volcanoes"]
    )
    prompt = _system_prompt(user, MOMENT, _TZ, ctx)
    assert "Library articles read: 5" in prompt
    assert '"The Internet"' in prompt
    assert '"Volcanoes"' in prompt


def test_system_prompt_omits_reading_when_none() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "Library articles" not in prompt
    assert "{READING_SECTION}" not in prompt


def test_system_prompt_includes_time_of_day() -> None:
    user = User(ui_language="en", name="Alex")
    # MOMENT = 2026-11-14 10:00 UTC = 16:00 Bishkek (+6)
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "16:00" in prompt
    assert "afternoon" in prompt


def test_system_prompt_includes_sessions_today() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(sessions_today="3 (2 study, 1 spelling)"))
    assert "3 (2 study, 1 spelling)" in prompt


def test_system_prompt_includes_promised_days() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(promised_days="Mon, Wed, Fri"))
    assert "Mon, Wed, Fri" in prompt


def test_system_prompt_includes_promised_days_none() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "none" in prompt


def test_system_prompt_includes_last_study_today() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "today" in prompt


def test_system_prompt_includes_last_study_days_ago() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(last_study="3 days ago"))
    assert "3 days ago" in prompt


def test_system_prompt_includes_last_study_hour_precision() -> None:
    user = User(ui_language="en", name="Alex")
    for label in ("less than an hour ago", "1 hour ago", "5 hours ago"):
        prompt = _system_prompt(user, MOMENT, _TZ, _ctx(last_study=label))
        assert label in prompt


def test_system_prompt_includes_last_study_never() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(last_study="never"))
    assert "never" in prompt


def test_system_prompt_includes_words_today() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(words_today=7))
    assert "New words learned today: 7" in prompt


def test_system_prompt_includes_words_this_week() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(words_this_week=23))
    assert "New words learned this week: 23" in prompt


def test_system_prompt_includes_reviews_this_week() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(reviews_this_week=140))
    assert "Vocabulary reviews completed this week: 140" in prompt


def test_system_prompt_includes_days_this_week_with_promise() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(days_this_week="2 of 3 promised"))
    assert "2 of 3 promised" in prompt
    assert "Days studied this week" in prompt


def test_system_prompt_includes_days_this_week_no_promise() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(days_this_week="1 day"))
    assert "1 day" in prompt


def test_system_prompt_includes_retention_when_known() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(retention="82%"))
    assert "82%" in prompt
    assert "retention rate" in prompt


def test_system_prompt_includes_retention_no_data() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "no data yet" in prompt


def test_system_prompt_includes_spelling_accuracy_when_known() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(spelling_accuracy="74%"))
    assert "74%" in prompt
    assert "Spelling accuracy" in prompt


def test_system_prompt_includes_top_spelling_deck_when_set() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(top_spelling_deck=("Family", 8)))
    assert "Family" in prompt
    assert "8 words" in prompt
    assert "spelling" in prompt.lower()


def test_system_prompt_omits_spelling_deck_line_when_none() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(top_spelling_deck=None))
    assert "Top deck for spelling" not in prompt


def test_system_prompt_includes_total_decks_when_set() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(total_decks=4))
    assert "Total vocabulary decks: 4 decks" in prompt


def test_system_prompt_omits_total_decks_line_when_zero() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(total_decks=0))
    assert "Total vocabulary decks" not in prompt


def test_system_prompt_includes_vocab_counts() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(words_in_progress=320, words_learned=150))
    assert "320" in prompt
    assert "150" in prompt


def test_system_prompt_includes_course_level() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx(course_level="B1"))
    assert "B1" in prompt
    assert "Current course level" in prompt


def test_system_prompt_omits_level_when_none() -> None:
    user = User(ui_language="en", name="Alex")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "Current course level" not in prompt
    assert "{LEVEL_LINE}" not in prompt


def test_system_prompt_includes_daily_target_when_set() -> None:
    user = User(ui_language="en", name="Alex", daily_target_words=10)
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "10 new words/day" in prompt
    assert "Daily target" in prompt


def test_system_prompt_omits_daily_target_when_null() -> None:
    user = User(ui_language="en", name="Alex", daily_target_words=None)
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "Daily target" not in prompt
    assert "{PACE_LINE}" not in prompt


def test_status_returns_full_budget_before_any_chat(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "mentor_chats_per_day", 10)
    reset_limits()
    _enable_mentor(monkeypatch)
    resp = client.get("/api/mentor/status", headers=as_("ulla"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["chats_remaining"] == 10
    assert body["chats_limit"] == 10
    reset_limits()


def test_status_decrements_after_chat(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_chats_per_day", 5)
    reset_limits()
    _enable_mentor(monkeypatch)
    client.post("/api/mentor/chat", json={"message": "hi"}, headers=as_("vince"))
    resp = client.get("/api/mentor/status", headers=as_("vince"))
    assert resp.json()["chats_remaining"] == 4
    reset_limits()


def test_status_requires_tester_flag(client: TestClient) -> None:
    resp = client.get("/api/mentor/status", headers=as_("wendy"))
    assert resp.status_code == 403


def test_history_returns_empty_before_first_message(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    resp = client.get("/api/mentor/history", headers=as_("diana"))
    assert resp.status_code == 200
    assert resp.json()["messages"] == []


def test_history_returns_messages_after_chat(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    client.post("/api/mentor/chat", json={"message": "Hello"}, headers=as_("evan"))
    resp = client.get("/api/mentor/history", headers=as_("evan"))
    assert resp.status_code == 200
    items = resp.json()["messages"]
    assert len(items) == 2  # user + assistant
    assert items[0]["role"] == "user"
    assert items[0]["content"] == "Hello"
    assert items[1]["role"] == "assistant"
    assert "created_at" in items[0]


def test_history_strips_orphaned_trailing_user_message(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    # Establish the user and one complete exchange.
    client.post("/api/mentor/chat", json={"message": "hello"}, headers=as_("rose"))
    # Simulate a failed stream: insert a user message with no following assistant reply.
    # Use a timestamp after the assistant reply so the orphan sorts last.
    from datetime import timedelta

    user = db.scalar(select(User).where(User.auth_subject == "dev|rose"))
    assert user is not None
    db.add(
        MentorMessage(
            user_id=user.id,
            role="user",
            content="orphaned",
            created_at=MOMENT + timedelta(seconds=5),
        )
    )
    db.commit()
    # History should not expose the orphaned trailing user message.
    resp = client.get("/api/mentor/history", headers=as_("rose"))
    items = resp.json()["messages"]
    assert items[-1]["role"] == "assistant"
    assert all(m["content"] != "orphaned" for m in items)


def test_history_requires_tester_flag(client: TestClient) -> None:
    resp = client.get("/api/mentor/history", headers=as_("frank"))
    assert resp.status_code == 403


def test_clear_history_wipes_messages(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    client.post("/api/mentor/chat", json={"message": "test"}, headers=as_("grace"))
    # Messages are present before clear.
    assert len(client.get("/api/mentor/history", headers=as_("grace")).json()["messages"]) == 2
    # Clear returns 204 with no body.
    resp = client.delete("/api/mentor/history", headers=as_("grace"))
    assert resp.status_code == 204
    # History is empty after clear.
    assert client.get("/api/mentor/history", headers=as_("grace")).json()["messages"] == []


def test_clear_history_requires_tester_flag(client: TestClient) -> None:
    resp = client.delete("/api/mentor/history", headers=as_("henry"))
    assert resp.status_code == 403


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


def test_goal_starts_null(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    resp = client.get("/api/mentor/goal", headers=as_("iris"))
    assert resp.status_code == 200
    assert resp.json()["goal"] is None


def test_goal_set_and_retrieve(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    resp = client.put("/api/mentor/goal", json={"goal": "Reach B2 by June"}, headers=as_("jack"))
    assert resp.status_code == 200
    assert resp.json()["goal"] == "Reach B2 by June"
    resp = client.get("/api/mentor/goal", headers=as_("jack"))
    assert resp.json()["goal"] == "Reach B2 by June"


def test_goal_clear_with_empty_string(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    client.put("/api/mentor/goal", json={"goal": "Some goal"}, headers=as_("kim"))
    resp = client.put("/api/mentor/goal", json={"goal": ""}, headers=as_("kim"))
    assert resp.status_code == 200
    assert resp.json()["goal"] is None


def test_goal_too_long_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    resp = client.put("/api/mentor/goal", json={"goal": "x" * 201}, headers=as_("leo"))
    assert resp.status_code == 422


def test_goal_requires_tester_flag(client: TestClient) -> None:
    resp = client.get("/api/mentor/goal", headers=as_("mike"))
    assert resp.status_code == 403
    resp = client.put("/api/mentor/goal", json={"goal": "hi"}, headers=as_("mike"))
    assert resp.status_code == 403


def test_system_prompt_includes_goal_when_set() -> None:
    user = User(ui_language="en", name="Alex", mentor_goal="Reach B2 by June")
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "Reach B2 by June" in prompt
    assert "Learning goal" in prompt


def test_system_prompt_omits_goal_when_null() -> None:
    user = User(ui_language="en", name="Alex", mentor_goal=None)
    prompt = _system_prompt(user, MOMENT, _TZ, _ctx())
    assert "Learning goal" not in prompt
    assert "{GOAL_LINE}" not in prompt


def _parse_sse(raw: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for block in raw.strip().split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def test_stream_endpoint_emits_delta_and_done(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)
    resp = client.post("/api/mentor/chat/stream", json={"message": "hi"}, headers=as_("nancy"))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.text)
    deltas = [e for e in events if "delta" in e]
    done_events = [e for e in events if e.get("done")]
    assert len(deltas) > 0, "expected at least one delta event"
    assert len(done_events) == 1, "expected exactly one done event"
    assert "created_at" in done_events[0]
    assert "chats_remaining" in done_events[0]


def test_stream_endpoint_full_text_matches_demo_reply(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)
    resp = client.post("/api/mentor/chat/stream", json={"message": "hello"}, headers=as_("olivia"))
    events = _parse_sse(resp.text)
    full_text = "".join(str(e["delta"]) for e in events if "delta" in e)
    # Non-streaming endpoint gives the same demo reply; compare via history.
    history_resp = client.get("/api/mentor/history", headers=as_("olivia"))
    items = history_resp.json()["messages"]
    assistant_reply = next(m["content"] for m in items if m["role"] == "assistant")
    assert full_text == assistant_reply


def test_stream_endpoint_rate_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    monkeypatch.setattr(get_settings(), "mentor_chats_per_day", 1)
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)
    reset_limits()
    resp = client.post("/api/mentor/chat/stream", json={"message": "hi"}, headers=as_("peter"))
    assert resp.status_code == 200
    refused = client.post("/api/mentor/chat/stream", json={"message": "hi"}, headers=as_("peter"))
    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "mentor_chat_limit"
    reset_limits()


def test_stream_endpoint_requires_tester_flag(client: TestClient) -> None:
    resp = client.post("/api/mentor/chat/stream", json={"message": "hi"}, headers=as_("quinn"))
    assert resp.status_code == 403
