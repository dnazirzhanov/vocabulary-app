"""What the mentor remembers (ADR 0075): facts the learner confirmed or wrote, the plan's story
written by the coach, chat summaries, all in the prompt; and the eval scoring."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.services import mentor
from evals.run import load
from evals.score import Outcome, language_of, score
from tests.support import at

THURSDAY = datetime(2026, 11, 19, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(name: str = "ann", moment: datetime = THURSDAY) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment, "Asia/Bishkek")


def remember(client: TestClient, kind: str, text: str, who: str = "ann") -> dict[str, Any]:
    response = client.post(
        "/api/mentor/memory/facts",
        json={"kind": kind, "text": text, "source": "chat"},
        headers=as_(who),
    )
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def stream(client: TestClient, message: str, **body: Any) -> list[dict[str, Any]]:
    response = client.post(
        "/api/mentor/chat/stream", json={"message": message, **body}, headers=as_()
    )
    assert response.status_code == 200, response.text
    return [json.loads(x[6:]) for x in response.text.split("\n\n") if x.startswith("data: ")]


# --- facts ----------------------------------------------------------------------------------


def test_facts_are_kept_once_changed_with_history_and_forgotten_for_good(
    client: TestClient,
) -> None:
    remember(client, "why", "Хочет переехать в Канаду")
    twice = remember(client, "why", "хочет переехать в канаду")  # the same, tapped again
    assert [f["text"] for f in twice["facts"]] == ["Хочет переехать в Канаду"]
    fact_id = twice["facts"][0]["id"]
    changed = client.put(
        f"/api/mentor/memory/facts/{fact_id}",
        json={"kind": "why", "text": "Хочет учиться в Торонто"},
        headers=as_(),
    ).json()
    assert [(f["text"], f["source"]) for f in changed["facts"]] == [
        ("Хочет учиться в Торонто", "user")
    ]
    gone = client.delete(f"/api/mentor/memory/facts/{changed['facts'][0]['id']}", headers=as_())
    assert gone.json()["facts"] == []


def test_a_learners_facts_are_theirs_alone(client: TestClient) -> None:
    fact_id = remember(client, "likes", "Любит футбол")["facts"][0]["id"]
    assert client.get("/api/mentor/memory", headers=as_("bob")).json()["facts"] == []
    for call in (
        client.delete(f"/api/mentor/memory/facts/{fact_id}", headers=as_("bob")),
        client.put(
            f"/api/mentor/memory/facts/{fact_id}",
            json={"kind": "likes", "text": "x"},
            headers=as_("bob"),
        ),
    ):
        assert call.status_code == 404


def test_bad_facts_are_refused(client: TestClient) -> None:
    for body in (
        {"kind": "secret", "text": "x"},
        {"kind": "why", "text": "  "},
        {"kind": "why", "text": "x" * 201},
    ):
        assert client.post("/api/mentor/memory/facts", json=body, headers=as_()).status_code == 422


# --- the plan's story -----------------------------------------------------------------------


def test_the_coach_writes_what_happened(client: TestClient) -> None:
    def later(n: int) -> dict[str, str]:
        return as_(moment=THURSDAY + timedelta(minutes=n))

    client.put("/api/mentor/coach/goal", json={"kind": "ielts", "target": "6.5"}, headers=later(0))
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": [0, 1, 2, 3, 4], "start_minute": 1140, "minutes": 20},
        headers=later(1),
    )
    client.put("/api/mentor/coach/today", json={"mode": "minimum"}, headers=later(2))
    client.put("/api/me/promise/pause", json={"until": "2026-11-25"}, headers=later(3))
    timeline = client.get("/api/mentor/memory", headers=as_()).json()["timeline"]
    assert [e["kind"] for e in timeline] == ["paused", "today_changed", "time_promised", "goal_set"]
    assert timeline[2]["note"] == {"days": "01234", "start": "19:00", "minutes": 20}


# --- in the prompt --------------------------------------------------------------------------


class Recorder:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.system = ""
        monkeypatch.setattr(get_settings(), "mentor_chat_demo", False)
        monkeypatch.setattr(get_settings(), "deepseek_api_key", "test-key")
        monkeypatch.setattr(mentor, "_stream_with_tools", self.stream)
        monkeypatch.setattr(mentor, "_call_deepseek", lambda *a: "Обсуждали фразовые глаголы.")

    def stream(self, system: str, *_: Any) -> Any:
        self.system = system
        yield {"delta": "ok"}


def test_a_new_chat_knows_the_learner_and_what_came_before(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = Recorder(monkeypatch)
    remember(client, "why", "Хочет переехать в Канаду")
    remember(client, "energy", "Лучше занимается утром")
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": [0, 2, 4], "start_minute": 450, "minutes": 15},
        headers=as_(),
    )
    # A chat long enough to be summarised once its answers are out.
    first = stream(client, "Как учить фразовые глаголы?", new_conversation=True)
    chat = first[0]["conversation"]["id"]
    for n in range(2):
        stream(client, f"А ещё? {n}", conversation_id=chat)

    stream(client, "Привет", new_conversation=True)
    assert "[why] Хочет переехать в Канаду" in model.system
    assert "[energy] Лучше занимается утром" in model.system
    assert "time_promised (days=024, start=07:30, minutes=15)" in model.system
    assert "«Как учить фразовые глаголы?»: Обсуждали фразовые глаголы." in model.system


def test_without_memories_nothing_is_added(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = Recorder(monkeypatch)
    stream(client, "Привет", new_conversation=True)
    assert "What the learner told you" not in model.system


# --- the tools ------------------------------------------------------------------------------


def test_remember_offers_a_chip_and_saves_nothing_until_the_tap(client: TestClient) -> None:
    events = stream(client, "Я люблю футбол и сериалы", new_conversation=True)
    card = next(e["tool"]["card"] for e in events if "tool" in e and e["tool"]["status"] == "done")
    assert card == {"type": "memory", "kind": "likes", "text": "Я люблю футбол и сериалы"}
    assert client.get("/api/mentor/memory", headers=as_()).json()["facts"] == []


def test_recall_finds_facts_and_chats_by_their_words(client: TestClient) -> None:
    remember(client, "why", "Хочет переехать в Канаду")
    events = stream(client, "Помнишь, зачем я учу английский? Канада", new_conversation=True)
    tools = [e["tool"] for e in events if "tool" in e]
    assert [t["name"] for t in tools][:1] == ["recall"]


# --- evals ----------------------------------------------------------------------------------


def test_every_scenario_is_well_formed() -> None:
    cases = load()
    assert len({c["id"] for c in cases}) == len(cases) >= 10
    for case in cases:
        datetime.strptime(case["local"], "%Y-%m-%d %H:%M")
        assert case["message"] and case["expect"]


def test_scoring_catches_what_goes_wrong() -> None:
    good = Outcome(
        tools=["what_now", "offer_replies"],
        cards=[{"type": "activity"}, None],
        text="Сейчас 18:42 — начни со слов.",
    )
    assert (
        score(
            {
                "tools_any": ["what_now"],
                "mentions": ["18:42"],
                "language": "ru",
                "activity_cards_max": 1,
            },
            good,
        )
        == []
    )
    twice = Outcome(
        tools=["what_now", "suggest_activity"],
        cards=[{"type": "activity"}, {"type": "activity"}],
        text="Do this now.",
    )
    misses = score(
        {
            "tools_any": ["propose_goal"],
            "activity_cards_max": 1,
            "language": "ru",
            "no_numbers_except": ["0"],
        },
        twice,
    )
    assert len(misses) == 3
    invented = Outcome(text="Ты выучил 120 слов за 7 дней")
    assert score({"no_numbers_except": ["0"]}, invented) == ["numbers no tool gave: ['120', '7']"]
    assert language_of("**Сейчас** 12:48") == "ru" and language_of("Start now") == "en"


def test_summaries_follow_the_chat_in_steps(client: TestClient) -> None:
    from sqlalchemy import select

    from app.core.db import get_sessionmaker
    from app.models import MentorConversation

    first = stream(client, "Вопрос 0", new_conversation=True)
    chat = first[0]["conversation"]["id"]
    for n in range(1, 3):
        stream(client, f"Вопрос {n}", conversation_id=chat)
    with get_sessionmaker()() as db:
        row = db.scalars(select(MentorConversation)).one()
        assert row.summarized_messages == 6 and row.summary == "Вопрос 0"
