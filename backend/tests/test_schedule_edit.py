"""The mentor changes the calendar itself (ADR 0083): what the learner says about their week or a
day is saved at once, never doubled, past midnight split in two, and undone exactly by the card."""

import json
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User
from app.services import mentor_tools
from tests.support import at

THURSDAY = datetime(2026, 11, 19, 9, 0, tzinfo=UTC)  # Thursday 19 November
WEEKDAYS = [0, 1, 2, 3, 4]


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(name: str = "ann") -> dict[str, str]:
    return {"X-Dev-User": name} | at(THURSDAY)


def ctx_for(client: TestClient, db: Session, name: str = "ann") -> mentor_tools.ToolContext:
    client.get("/api/mentor/schedule", headers=as_(name))  # makes the learner
    user = db.scalars(select(User).where(User.auth_subject == f"dev|{name}")).one()
    return mentor_tools.ToolContext(db, user, THURSDAY, ZoneInfo("UTC"), [])


def week(client: TestClient, name: str = "ann") -> list[tuple[str, str, int, int, int]]:
    events = client.get("/api/mentor/schedule", headers=as_(name)).json()["events"]
    return sorted(
        (e["title"], e["kind"], e["weekdays"], e["start_minute"], e["end_minute"]) for e in events
    )


def block(
    title: str, days: list[int], start: str, end: str, kind: str = "school"
) -> dict[str, Any]:
    return {"title": title, "kind": kind, "weekdays": days, "start": start, "end": end}


def save(ctx: mentor_tools.ToolContext, **args: Any) -> dict[str, Any]:
    out = mentor_tools.set_schedule(ctx, args)
    assert out.card is not None, out.result
    return out.card


def test_sleep_past_midnight_is_saved_as_two_blocks(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    save(ctx, add=[block("Сон", WEEKDAYS, "23:00", "07:00", kind="sleep")])
    # Mon–Fri nights: the evening on Mon–Fri, the morning after on Tue–Sat.
    assert week(client) == [
        ("Сон", "sleep", 0b0011111, 1380, 1440),
        ("Сон", "sleep", 0b0111110, 0, 420),
    ]


def test_saying_the_week_again_never_doubles_it(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    save(ctx, add=[block("Школа", WEEKDAYS, "08:30", "13:30")])
    save(ctx, add=[block("школа", WEEKDAYS, "09:00", "14:00")])
    assert week(client) == [("школа", "school", 31, 540, 840)]


def test_a_change_on_one_day_keeps_the_others(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    save(ctx, add=[block("Школа", WEEKDAYS, "08:30", "13:30")])
    card = save(ctx, add=[block("Школа", [4], "08:30", "12:00")])
    assert week(client) == [
        ("Школа", "school", 0b01111, 510, 810),
        ("Школа", "school", 0b10000, 510, 720),
    ]
    assert [b["weekdays"] for b in card["removed"]] == [[4]]


def test_same_title_at_another_time_is_another_block(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    save(ctx, add=[block("Тренировка", [0], "07:00", "08:00", kind="sport")])
    save(ctx, add=[block("Тренировка", [0], "18:00", "19:00", kind="sport")])
    assert len(week(client)) == 2


def test_a_block_is_removed_by_its_title(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    save(
        ctx,
        add=[
            block("Школа", WEEKDAYS, "08:30", "13:30"),
            block("Гитара", [1, 3], "17:00", "18:00", kind="personal"),
        ],
    )
    save(ctx, remove=[{"title": "школа", "weekdays": [2]}])
    save(ctx, remove=[{"title": "Гитара"}])
    assert week(client) == [("Школа", "school", 0b11011, 510, 810)]
    # Nothing by that name: nothing saved, and the model is told.
    assert mentor_tools.set_schedule(ctx, {"remove": [{"title": "Танцы"}]}).result == {
        "saved": False,
        "changed": 0,
        "dropped": 0,
    }


def test_undo_puts_the_week_back_exactly(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    save(ctx, add=[block("Школа", WEEKDAYS, "08:30", "13:30")])
    save(ctx, add=[block("Гитара", [1], "17:00", "18:00", kind="personal")])
    before = week(client)
    card = save(
        ctx,
        add=[block("Школа", [4], "08:30", "12:00"), block("Сон", [0], "23:00", "07:00", "sleep")],
        remove=[{"title": "Гитара"}],
    )
    assert week(client) != before
    response = client.post("/api/mentor/schedule/undo", json=card["undo"], headers=as_())
    assert response.status_code == 204
    assert week(client) == before
    # Undoing twice changes nothing more.
    client.post("/api/mentor/schedule/undo", json=card["undo"], headers=as_())
    assert week(client) == before


def test_undo_never_touches_another_learners_blocks(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    card = save(ctx, add=[block("Школа", WEEKDAYS, "08:30", "13:30")])
    replaced = save(ctx, add=[block("Школа", WEEKDAYS, "09:00", "14:00")])
    before = week(client)
    ctx_for(client, db, "bob")
    for undo in (card["undo"], replaced["undo"]):
        client.post("/api/mentor/schedule/undo", json=undo, headers=as_("bob"))
    # Ann's week is as it was. (What Bob sent may become Bob's own block: no more than he could
    # add himself.)
    assert week(client) == before


def stream(client: TestClient, message: str) -> list[dict[str, Any]]:
    response = client.post(
        "/api/mentor/chat/stream",
        json={"message": message, "new_conversation": True},
        headers=as_(),
    )
    events = [json.loads(x[6:]) for x in response.text.split("\n\n") if x.startswith("data: ")]
    return [e["tool"] for e in events if "tool" in e and e["tool"]["status"] == "done"]


def test_told_in_the_chat_it_is_in_the_calendar(client: TestClient) -> None:
    tools = stream(client, "И я сплю с 23:00 до 7:00, поставь в календарь")
    assert tools[0]["name"] == "set_schedule" and tools[0]["card"]["type"] == "schedule_saved"
    assert week(client) == [
        ("Сон", "sleep", 127, 0, 420),
        ("Сон", "sleep", 127, 1380, 1440),
    ]


def test_asked_for_the_schedule_it_shows_the_day(client: TestClient, db: Session) -> None:
    ctx = ctx_for(client, db)
    save(ctx, add=[block("Школа", WEEKDAYS, "08:30", "13:30")])
    tools = stream(client, "Какое у меня расписание?")
    assert [t["name"] for t in tools] == ["show"]
    card = tools[0]["card"]
    assert card["type"] == "day" and card["date"] == "2026-11-19"
    assert [(b["title"], b["start_minute"]) for b in card["blocks"]] == [("Школа", 510)]
    # Another day, when asked: Sunday has no school.
    sunday = mentor_tools.show(ctx, {"component": "day", "date": "2026-11-22"}).card
    assert sunday is not None and sunday["date"] == "2026-11-22" and sunday["blocks"] == []
