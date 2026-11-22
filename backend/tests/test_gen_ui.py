"""The mentor composes the interface (ADR 0077): one show tool, a typed catalogue of components,
every fact filled in by the server, every card validated before it is sent."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User, UserWordProgress, WritingSubmission
from app.schemas.gen_ui import GenCard
from app.services import mentor_tools
from tests.support import at, finish

THURSDAY = datetime(2026, 11, 19, 9, 0, tzinfo=UTC)
UTC_ZONE = ZoneInfo("UTC")
CATALOGUE: TypeAdapter[Any] = TypeAdapter(GenCard)


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(moment: datetime = THURSDAY) -> dict[str, str]:
    return {"X-Dev-User": "ann"} | at(moment)


def ann(db: Session, client: TestClient) -> User:
    client.get("/api/me", headers=as_())
    return db.scalars(select(User).where(User.auth_subject == "dev|ann")).one()


def show(db: Session, client: TestClient, **args: Any) -> mentor_tools.ToolResult:
    ctx = mentor_tools.ToolContext(db, ann(db, client), THURSDAY, UTC_ZONE, [])
    result = mentor_tools.show(ctx, args)
    if result.card is not None:
        CATALOGUE.validate_python(result.card)  # what is sent is always in the catalogue
    return result


def test_today_shows_only_todays_blocks_with_the_study_time_and_kind_of_day(
    client: TestClient, db: Session
) -> None:
    school = client.post(
        "/api/mentor/schedule",
        json={
            "title": "Школа",
            "kind": "school",
            "weekdays": 127,
            "start_minute": 480,
            "end_minute": 840,
        },
        headers=as_(),
    ).json()
    client.post(
        "/api/mentor/schedule",
        json={
            "title": "Отдых",
            "kind": "rest",
            "weekdays": 127,
            "start_minute": 840,
            "end_minute": 930,
        },
        headers=as_(),
    )
    client.post(
        f"/api/mentor/schedule/{school['id']}/skips", json={"date": "2026-11-19"}, headers=as_()
    )
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": list(range(7)), "start_minute": 1140, "minutes": 20},
        headers=as_(),
    )
    client.put("/api/mentor/coach/day-type", json={"type": "light"}, headers=as_())
    card = show(db, client, component="day").card
    assert card == {
        "type": "day",
        "date": "2026-11-19",
        "blocks": [{"title": "Отдых", "kind": "rest", "start_minute": 840, "end_minute": 930}],
        "study_start": 1140,
        "day_type": "light",
    }


def test_words_are_the_ones_due_and_none_means_no_card(client: TestClient, db: Session) -> None:
    assert show(db, client, component="words").card is None
    learned = THURSDAY - timedelta(days=12)
    headers = as_(learned)
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=headers
    ).json()
    finish(client, session, headers)
    user = ann(db, client)
    db.execute(
        update(UserWordProgress)
        .where(UserWordProgress.user_id == user.id)
        .values(due_at=THURSDAY - timedelta(hours=1))
    )
    db.commit()
    card = show(db, client, component="words").card
    assert card is not None and card["type"] == "words"
    assert 1 <= len(card["words"]) <= 5 and card["due"] >= len(card["words"])
    assert all(w["en"] and w["l1"] for w in card["words"])


def test_a_choice_is_checked_and_trimmed(client: TestClient, db: Session) -> None:
    ok = show(
        db,
        client,
        component="choice",
        question="Сколько минут в день?",
        options=["10", "  15  ", "", "x" * 60, "30", "45"],
    ).card
    assert ok == {
        "type": "choice",
        "question": "Сколько минут в день?",
        "options": ["10", "15", "x" * 40, "30"],
    }
    one = show(db, client, component="choice", question="Готов?", options=["Да"])
    assert one.card is None and "error" in one.result
    empty = show(db, client, component="choice", question=" ", options=["Да", "Нет"])
    assert empty.card is None and "error" in empty.result


def test_only_true_milestones_are_celebrated(client: TestClient, db: Session) -> None:
    nothing = show(db, client, component="celebrate")
    assert nothing.card is None and nothing.result["shown"] is False
    db.add(
        WritingSubmission(
            user_id=ann(db, client).id,
            client_id=uuid.uuid4(),
            question_id="q",
            answer="x",
            status="done",
            created_at=THURSDAY - timedelta(days=1),
        )
    )
    db.commit()
    card = show(db, client, component="celebrate").card
    assert card == {"type": "celebrate", "milestones": [{"kind": "days_this_week", "value": 1}]}


def test_the_kind_of_day_check_knows_the_current_choice(client: TestClient, db: Session) -> None:
    assert show(db, client, component="day_check").card == {"type": "day_check", "current": None}
    client.put("/api/mentor/coach/day-type", json={"type": "exam"}, headers=as_())
    assert show(db, client, component="day_check").card == {"type": "day_check", "current": "exam"}


def test_an_unknown_component_is_refused(client: TestClient, db: Session) -> None:
    result = show(db, client, component="html", question="<script>")
    assert result.card is None and "unknown component" in result.result["error"]


def test_the_chat_streams_a_component_card(client: TestClient) -> None:
    response = client.post(
        "/api/mentor/chat/stream",
        json={"message": "Как выглядит мой день?", "new_conversation": True},
        headers=as_(),
    )
    events = [json.loads(x[6:]) for x in response.text.split("\n\n") if x.startswith("data: ")]
    tools = [e["tool"] for e in events if "tool" in e]
    assert [(t["name"], t["status"]) for t in tools][:2] == [("show", "running"), ("show", "done")]
    assert tools[1]["card"]["type"] == "day"
