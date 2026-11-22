"""Chats with the mentor (ADR 0072): several conversations, tool calls run on the coach's rules
and kept with the answer, the right time for the learner's own zone, and nothing saved by a tool.
The model is never called: a fake OpenAI client streams scripted chunks."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, ClassVar
from zoneinfo import ZoneInfo

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_engine
from app.models import User
from app.services import mentor, mentor_tools
from tests.support import at

THURSDAY = datetime(2026, 11, 19, 15, 0, tzinfo=UTC)  # 21:00 in Bishkek
BISHKEK = "Asia/Bishkek"
PLAN = [
    {"kind": "vocab", "title": "A1–A2", "count": 12, "minutes": 4, "deckId": "a1-a2"},
    {"kind": "reading", "title": "Tea", "minutes": 6, "articleId": "tea", "level": "B1"},
]


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(name: str = "ann", moment: datetime = THURSDAY, zone: str = BISHKEK) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment, zone)


def events(
    client: TestClient, who: str = "ann", moment: datetime = THURSDAY, **body: Any
) -> list[dict[str, Any]]:
    response = client.post("/api/mentor/chat/stream", json=body, headers=as_(who, moment))
    assert response.status_code == 200, response.text
    return [
        json.loads(line[6:]) for line in response.text.split("\n\n") if line.startswith("data: ")
    ]


def conversation_id(stream: list[dict[str, Any]]) -> str:
    return str(stream[0]["conversation"]["id"])


# --- chats ----------------------------------------------------------------------------------


def test_each_new_chat_is_its_own_conversation_named_by_its_first_question(
    client: TestClient,
) -> None:
    first = events(client, message="How do I learn phrasal verbs faster?", new_conversation=True)
    later = THURSDAY.replace(minute=5)
    events(client, moment=later, message="Помоги с IELTS", new_conversation=True)
    assert first[0]["conversation"]["title"] == "How do I learn phrasal verbs faster?"
    listed = client.get("/api/mentor/conversations", headers=as_()).json()
    assert [c["title"] for c in listed] == [
        "Помоги с IELTS",
        "How do I learn phrasal verbs faster?",
    ]
    # Continuing the first keeps the second apart.
    events(
        client,
        moment=later.replace(minute=10),
        message="And idioms?",
        conversation_id=conversation_id(first),
    )
    messages = client.get(
        f"/api/mentor/conversations/{conversation_id(first)}/messages", headers=as_()
    ).json()
    assert [m["content"] for m in messages if m["role"] == "user"] == [
        "How do I learn phrasal verbs faster?",
        "And idioms?",
    ]
    assert client.get("/api/mentor/conversations", headers=as_()).json()[0][
        "id"
    ] == conversation_id(first)


def test_a_long_first_question_gives_a_short_title() -> None:
    title = mentor.title_of(
        "Я хочу сдать IELTS на 6.5 к июню, но у меня мало времени, что делать " * 2
    )
    assert len(title) <= 61 and title.endswith("…")


def test_chats_can_be_renamed_and_deleted_and_are_their_owners_alone(client: TestClient) -> None:
    chat = conversation_id(events(client, message="Привет", new_conversation=True))
    renamed = client.patch(
        f"/api/mentor/conversations/{chat}", json={"title": "Мой план"}, headers=as_()
    )
    assert renamed.json()["title"] == "Мой план"
    bob = as_("bob")
    assert client.get(f"/api/mentor/conversations/{chat}/messages", headers=bob).status_code == 404
    renamed_by_bob = client.patch(
        f"/api/mentor/conversations/{chat}", json={"title": "x"}, headers=bob
    )
    assert renamed_by_bob.status_code == 404
    assert client.delete(f"/api/mentor/conversations/{chat}", headers=bob).status_code == 404
    stream = client.post(
        "/api/mentor/chat/stream",
        json={"message": "hi", "conversation_id": chat},
        headers=as_("bob"),
    )
    assert stream.status_code == 404
    assert client.delete(f"/api/mentor/conversations/{chat}", headers=as_()).status_code == 204
    assert client.get("/api/mentor/conversations", headers=as_()).json() == []


def test_the_app_before_chats_still_continues_one_conversation(client: TestClient) -> None:
    events(client, message="Первый вопрос")
    events(client, message="Второй вопрос")
    assert len(client.get("/api/mentor/conversations", headers=as_()).json()) == 1
    history = client.get("/api/mentor/history", headers=as_()).json()["messages"]
    assert [m["content"] for m in history if m["role"] == "user"] == [
        "Первый вопрос",
        "Второй вопрос",
    ]


# --- the right time -------------------------------------------------------------------------


class Recorder:
    """Stands in for the streaming model call and keeps what it was given."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.system = ""
        self.messages: list[dict[str, str]] = []
        monkeypatch.setattr(get_settings(), "mentor_chat_demo", False)
        monkeypatch.setattr(get_settings(), "deepseek_api_key", "test-key")
        monkeypatch.setattr(mentor, "_stream_with_tools", self.stream)

    def stream(
        self, system: str, messages: list[dict[str, str]], *_: Any
    ) -> Iterator[dict[str, Any]]:
        self.system, self.messages = system, messages
        yield {"delta": "ok"}


def test_the_prompt_opens_with_the_learners_own_time_and_dates_their_earlier_messages(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = Recorder(monkeypatch)
    morning = datetime(2026, 11, 19, 2, 15, tzinfo=UTC)  # 08:15 in Bishkek
    chat = conversation_id(
        events(client, moment=morning, message="Доброе утро!", new_conversation=True)
    )
    events(client, message="Сколько сейчас времени?", conversation_id=chat)
    assert model.system.startswith(
        "It is now Thursday, 2026-11-19, 21:00 (night) in the learner's own time zone "
        "(Asia/Bishkek)."
    )
    assert "out of date" in model.system
    assert model.messages[0] == {"role": "user", "content": "[Thu 08:15] Доброе утро!"}
    assert model.messages[-1] == {"role": "user", "content": "Сколько сейчас времени?"}


@pytest.mark.parametrize(
    ("zone", "local"),
    [("Europe/Budapest", "16:00"), ("UTC", "15:00"), ("America/New_York", "10:00")],
)
def test_every_zone_gets_its_own_time(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, zone: str, local: str
) -> None:
    model = Recorder(monkeypatch)
    client.post(
        "/api/mentor/chat/stream",
        json={"message": "hi", "new_conversation": True},
        headers=as_(zone=zone),
    )
    assert f"2026-11-19, {local}" in model.system and f"({zone})" in model.system


# --- tools ----------------------------------------------------------------------------------


def _chunk(content: str | None = None, call: dict[str, Any] | None = None) -> Any:
    calls = None
    if call:
        calls = [
            SimpleNamespace(
                index=call.get("index", 0),
                id=call.get("id"),
                function=SimpleNamespace(name=call.get("name"), arguments=call.get("arguments")),
            )
        ]
    delta = SimpleNamespace(content=content, tool_calls=calls)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


class FakeOpenAI:
    """A model that calls `what_now` (its arguments split over two chunks), then answers."""

    rounds: ClassVar[list[list[Any]]] = []

    def __init__(self, **_: Any) -> None:
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs: Any) -> Iterator[Any]:
        FakeOpenAI.rounds.append(list(kwargs["messages"]))
        if len(FakeOpenAI.rounds) == 1:
            assert kwargs["tools"] == mentor_tools.TOOLS
            return iter(
                [
                    _chunk(call={"id": "call-1", "name": "what_now", "arguments": "{"}),
                    _chunk(call={"arguments": "}"}),
                ]
            )
        return iter([_chunk("Начни со слов — "), _chunk("4 минуты.")])


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> type[FakeOpenAI]:
    import openai

    FakeOpenAI.rounds = []
    monkeypatch.setattr(get_settings(), "mentor_chat_demo", False)
    monkeypatch.setattr(get_settings(), "deepseek_api_key", "test-key")
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    return FakeOpenAI


def test_asking_what_to_do_runs_the_tool_shows_a_start_card_and_answers(
    client: TestClient, model: type[FakeOpenAI]
) -> None:
    stream = events(client, message="Что мне сейчас делать?", plan=PLAN, new_conversation=True)
    tools = [e["tool"] for e in stream if "tool" in e]
    assert [(t["name"], t["status"]) for t in tools] == [
        ("what_now", "running"),
        ("what_now", "done"),
    ]
    card = tools[1]["card"]
    assert card["type"] == "activity" and card["kind"] == "vocab" and card["deck_id"] == "a1-a2"
    assert "".join(e["delta"] for e in stream if "delta" in e) == "Начни со слов — 4 минуты."
    # The tool's result went back to the model, which then answered.
    told = model.rounds[1][-1]
    assert told["role"] == "tool" and json.loads(told["content"])["state"] == "do"
    assert model.rounds[1][-2]["tool_calls"][0]["function"]["name"] == "what_now"
    # Kept with the answer, so reopening the chat shows the card again.
    saved = client.get(
        f"/api/mentor/conversations/{conversation_id(stream)}/messages", headers=as_()
    ).json()
    assert saved[-1]["parts"] == [{"type": "tool", "name": "what_now", "card": card}]


def test_without_a_model_the_question_plainly_asked_gets_its_tool(client: TestClient) -> None:
    stream = events(client, message="Что мне сейчас делать?", plan=PLAN, new_conversation=True)
    done = [e["tool"] for e in stream if "tool" in e and e["tool"]["status"] == "done"]
    assert done[0]["name"] == "what_now" and done[0]["card"]["article_id"] is None
    writing = events(client, message="Хочу писать эссе", new_conversation=True)
    card = next(e["tool"]["card"] for e in writing if "tool" in e and e["tool"]["status"] == "done")
    assert card["kind"] == "writing" and card["minutes"] == 15


def test_a_week_told_to_the_mentor_is_saved_at_once(client: TestClient) -> None:
    # ADR 0083: no confirming tap; the card says what changed and can undo it.
    stream = events(client, message="Вот моё расписание: учусь пн–пт 8–14", new_conversation=True)
    card = next(e["tool"]["card"] for e in stream if "tool" in e and e["tool"]["status"] == "done")
    assert card["type"] == "schedule_saved" and card["added"][0]["start_minute"] == 480
    saved = client.get("/api/mentor/schedule", headers=as_()).json()["events"]
    assert [(e["title"], e["weekdays"], e["start_minute"]) for e in saved] == [("Школа", 31, 480)]


def test_a_proposed_goal_is_checked_but_never_saved(client: TestClient) -> None:
    stream = events(client, message="Моя цель — IELTS", new_conversation=True)
    card = next(e["tool"]["card"] for e in stream if "tool" in e and e["tool"]["status"] == "done")
    assert card["type"] == "goal" and card["target"] == "6.5"
    assert client.get("/api/mentor/coach", headers=as_()).json()["goal"] is None


def test_bad_blocks_are_dropped_not_invented(client: TestClient, db: Session) -> None:
    client.get("/api/mentor/schedule", headers=as_())  # makes the learner
    ann = db.scalars(select(User).where(User.auth_subject == "dev|ann")).one()
    ctx = mentor_tools.ToolContext(db, ann, THURSDAY, ZoneInfo("UTC"), [])
    out = mentor_tools.set_schedule(
        ctx,
        {
            "add": [
                {
                    "title": "Gym",
                    "kind": "sport",
                    "weekdays": [1, 3],
                    "start": "18:00",
                    "end": "19:00",
                },
                {"title": "", "kind": "sport", "weekdays": [1], "start": "18:00", "end": "19:00"},
                {
                    "title": "Late",
                    "kind": "party",
                    "weekdays": [9],
                    "start": "22:00",
                    "end": "23:00",
                },
                {
                    "title": "Same",
                    "kind": "work",
                    "weekdays": [0],
                    "start": "19:00",
                    "end": "19:00",
                },
                "nonsense",
            ]
        },
    )
    assert out.card is not None and out.card["added"] == [
        {
            "title": "Gym",
            "kind": "sport",
            "weekdays": [1, 3],
            "start_minute": 1080,
            "end_minute": 1140,
            "on_date": None,
        }
    ]
    assert out.result["saved"] is True and out.result["dropped"] == 4
    # Nothing valid: nothing saved, and the model is told so.
    assert mentor_tools.set_schedule(ctx, {"add": ["nonsense"]}).result["saved"] is False
    # A kind of activity with nothing today is said, not made up.
    assert mentor_tools.suggest_activity(ctx, {"kind": "spelling"}).card is None


# --- the migration --------------------------------------------------------------------------


def test_messages_from_before_chats_become_each_learners_first_chat(database: None) -> None:
    config = Config("alembic.ini")
    command.downgrade(config, "e4b2d6a8c013")
    try:
        with get_engine().begin() as db:
            db.execute(text("DELETE FROM users WHERE auth_subject = 'dev|old-chat'"))
            user = db.execute(
                text(
                    "INSERT INTO users (id, auth_subject) "
                    "VALUES (gen_random_uuid(), 'dev|old-chat') RETURNING id"
                )
            ).scalar_one()
            for n, (role, content) in enumerate(
                [("user", "Как учить слова?"), ("assistant", "По 10 в день."), ("user", "А ещё?")]
            ):
                db.execute(
                    text(
                        "INSERT INTO mentor_messages (id, user_id, role, content, created_at) "
                        "VALUES (gen_random_uuid(), :u, :r, :c, :t)"
                    ),
                    {
                        "u": user,
                        "r": role,
                        "c": content,
                        "t": datetime(2026, 11, 1, 10, n, tzinfo=UTC),
                    },
                )
        command.upgrade(config, "head")
        with get_engine().begin() as db:
            chats = db.execute(
                text("SELECT id, title FROM mentor_conversations WHERE user_id = :u"), {"u": user}
            ).all()
            assert [title for _, title in chats] == ["Как учить слова?"]
            unassigned = db.execute(
                text(
                    "SELECT count(*) FROM mentor_messages "
                    "WHERE user_id = :u AND conversation_id IS NULL"
                ),
                {"u": user},
            ).scalar_one()
            assert unassigned == 0
            db.execute(text("DELETE FROM users WHERE id = :u"), {"u": user})
    finally:
        command.upgrade(config, "head")


# --- tool calls written as text (DeepSeek's markup) -----------------------------------------

MARKUP = (
    '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="show">\n'
    '<｜｜DSML｜｜ parameter name="component" string="true">day</｜｜DSML｜｜ parameter>\n'
    '<｜｜DSML｜｜ parameter name="limit" string="false">3</｜｜DSML｜｜ parameter>\n'
    "</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>"
)


def test_the_markup_is_held_back_even_split_across_chunks() -> None:
    from app.services import dsml

    guard = dsml.Guard()
    pieces = ["Готово: школы нет.\n\n<", "｜｜DSML｜｜ calls>", MARKUP[20:]]
    shown = "".join(guard.feed(p) for p in pieces) + guard.end()
    assert shown == "Готово: школы нет.\n\n"
    assert dsml.calls(guard.markup) == [("show", {"component": "day", "limit": 3})]
    # A plain «<» in an answer is shown as it is.
    plain = dsml.Guard()
    assert plain.feed("5 <") + plain.feed(" 10") + plain.end() == "5 < 10"
    assert dsml.calls("no markup here") == []


class TextCallOpenAI:
    """A model that writes its `show` call as text, then answers in the next round."""

    rounds: ClassVar[list[dict[str, Any]]] = []

    def __init__(self, **_: Any) -> None:
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs: Any) -> Iterator[Any]:
        TextCallOpenAI.rounds.append(kwargs)
        if len(TextCallOpenAI.rounds) == 1:
            return iter([_chunk("Вот твой день."), _chunk("\n<"), _chunk(MARKUP[1:])])
        return iter([_chunk(" Хорошего дня!")])


def test_a_tool_call_written_as_text_is_run_and_never_shown(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import openai

    TextCallOpenAI.rounds = []
    monkeypatch.setattr(get_settings(), "mentor_chat_demo", False)
    monkeypatch.setattr(get_settings(), "deepseek_api_key", "test-key")
    monkeypatch.setattr(openai, "OpenAI", TextCallOpenAI)
    stream = events(client, message="Какой у меня день?", new_conversation=True)
    said = "".join(e["delta"] for e in stream if "delta" in e)
    assert said == "Вот твой день.\n Хорошего дня!"
    assert "DSML" not in said and "｜" not in said
    done = [e["tool"] for e in stream if "tool" in e and e["tool"]["status"] == "done"]
    assert [t["name"] for t in done] == ["show"] and done[0]["card"]["type"] == "day"
    # The model was told the result, as for any call.
    assert TextCallOpenAI.rounds[1]["messages"][-1]["role"] == "tool"


def test_markup_past_the_last_round_is_dropped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import openai

    class Stubborn(TextCallOpenAI):
        def create(self, **kwargs: Any) -> Iterator[Any]:
            TextCallOpenAI.rounds.append(kwargs)
            return iter([_chunk("Ответ."), _chunk(MARKUP)])

    TextCallOpenAI.rounds = []
    monkeypatch.setattr(get_settings(), "mentor_chat_demo", False)
    monkeypatch.setattr(get_settings(), "deepseek_api_key", "test-key")
    monkeypatch.setattr(openai, "OpenAI", Stubborn)
    stream = events(client, message="Какой у меня день?", new_conversation=True)
    said = "".join(e["delta"] for e in stream if "delta" in e)
    assert "DSML" not in said and said.startswith("Ответ.")
    # It keeps asking in text; the rounds end, and no tools were offered in the last one.
    assert len(TextCallOpenAI.rounds) == mentor.MAX_TOOL_ROUNDS + 1
    assert "tools" not in TextCallOpenAI.rounds[-1] or not TextCallOpenAI.rounds[-1]["tools"]
