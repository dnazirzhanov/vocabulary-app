"""When a day is different (ADR 0074): one-off blocks and single-day skips in the schedule, the
choice made when today doesn't work, never missing twice, the chat's exception card and quick
replies, and one card for one activity."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User, WritingSubmission
from app.services import mentor, mentor_tools
from app.services.coach import service as coach
from tests.support import at

THURSDAY = datetime(2026, 11, 19, 9, 0, tzinfo=UTC)  # Thursday 19 November
UTC_ZONE = ZoneInfo("UTC")
SCHOOL: dict[str, Any] = {
    "title": "Школа",
    "kind": "school",
    "weekdays": 31,
    "start_minute": 480,
    "end_minute": 840,
}


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(name: str = "ann", moment: datetime = THURSDAY) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


def add(client: TestClient, *, who: str = "ann", **event: Any) -> dict[str, Any]:
    response = client.post("/api/mentor/schedule", json=event, headers=as_(who))
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def user_of(db: Session, name: str = "ann") -> User:
    return db.scalars(select(User).where(User.auth_subject == f"dev|{name}")).one()


# --- one-off blocks and skips ---------------------------------------------------------------


def test_a_one_off_block_is_on_its_date_only(client: TestClient, db: Session) -> None:
    concert = add(
        client,
        title="Концерт",
        kind="personal",
        weekdays=1,
        start_minute=900,
        end_minute=1080,
        on_date="2026-11-21",
    )
    assert concert["on_date"] == "2026-11-21"
    assert concert["weekdays"] == 1 << 5  # Saturday, whatever was sent
    ann = user_of(db)
    saturday = datetime(2026, 11, 21).date()
    assert [t for t, _ in coach.blocks_on(db, ann, saturday)] == ["Концерт"]
    assert coach.blocks_on(db, ann, saturday + timedelta(days=7)) == []
    # Not part of the repeating week the study times are found in.
    assert coach.schedule_of(db, ann) == []


def test_a_skipped_day_takes_one_date_off_a_repeating_block(
    client: TestClient, db: Session
) -> None:
    school = add(client, **SCHOOL)
    friday = "2026-11-20"
    for _ in range(2):  # repeating it changes nothing
        assert (
            client.post(
                f"/api/mentor/schedule/{school['id']}/skips", json={"date": friday}, headers=as_()
            ).status_code
            == 204
        )
    listed = client.get("/api/mentor/schedule", headers=as_()).json()["events"]
    assert listed[0]["skipped"] == [friday]
    ann = user_of(db)
    assert coach.blocks_on(db, ann, datetime(2026, 11, 20).date()) == []
    assert len(coach.blocks_on(db, ann, datetime(2026, 11, 23).date())) == 1
    client.delete(f"/api/mentor/schedule/{school['id']}/skips/{friday}", headers=as_())
    assert client.get("/api/mentor/schedule", headers=as_()).json()["events"][0]["skipped"] == []


def test_someone_elses_block_cannot_be_skipped(client: TestClient) -> None:
    school = add(client, **SCHOOL)
    response = client.post(
        f"/api/mentor/schedule/{school['id']}/skips",
        json={"date": "2026-11-20"},
        headers=as_("bob"),
    )
    assert response.status_code == 404


def test_what_now_sees_todays_blocks_with_skips_and_one_offs(
    client: TestClient, db: Session
) -> None:
    school = add(client, **SCHOOL)
    tasks = [{"kind": "vocab", "deckId": "a1-a2", "minutes": 4}]
    ten = datetime(2026, 11, 19, 10, 0, tzinfo=UTC)
    ann = user_of(db)
    assert coach.now_for(db, ann, tasks, ten, UTC_ZONE).state == "busy"
    client.post(
        f"/api/mentor/schedule/{school['id']}/skips", json={"date": "2026-11-19"}, headers=as_()
    )
    assert coach.now_for(db, ann, tasks, ten, UTC_ZONE).state == "do"


# --- today's choice, never twice ------------------------------------------------------------


def commit_last_week(client: TestClient) -> None:
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": [0, 1, 2, 3, 4, 5, 6], "start_minute": 1140, "minutes": 20},
        headers=as_(moment=datetime(2026, 11, 10, 9, tzinfo=UTC)),
    )


def test_today_doesnt_work_so_the_minimum_moved_or_skipped_is_kept_for_today(
    client: TestClient,
) -> None:
    state = client.put("/api/mentor/coach/today", json={"mode": "minimum"}, headers=as_()).json()
    assert state["today"]["override_mode"] == "minimum"
    moved = client.put(
        "/api/mentor/coach/today", json={"mode": "moved", "start_minute": 1260}, headers=as_()
    ).json()
    assert (moved["today"]["override_mode"], moved["today"]["override_start"]) == ("moved", 1260)
    assert (
        client.put("/api/mentor/coach/today", json={"mode": "moved"}, headers=as_()).status_code
        == 422
    )
    undone = client.delete("/api/mentor/coach/today", headers=as_()).json()
    assert undone["today"]["override_mode"] is None
    # Tomorrow starts clean.
    client.put("/api/mentor/coach/today", json={"mode": "skip"}, headers=as_())
    tomorrow = client.get("/api/mentor/coach", headers=as_(moment=THURSDAY + timedelta(days=1)))
    assert tomorrow.json()["today"]["override_mode"] is None


def test_a_missed_promised_day_is_said_once_never_for_a_new_learner(
    client: TestClient, db: Session
) -> None:
    # A new learner: nothing missed yet.
    assert (
        client.get("/api/mentor/coach", headers=as_()).json()["today"]["missed_yesterday"] is False
    )
    commit_last_week(client)
    assert (
        client.get("/api/mentor/coach", headers=as_()).json()["today"]["missed_yesterday"] is True
    )
    # Something done yesterday: not missed.
    db.add(
        WritingSubmission(
            user_id=user_of(db).id,
            client_id=uuid.uuid4(),
            question_id="q",
            answer="x",
            status="done",
            created_at=datetime(2026, 11, 18, 18, tzinfo=UTC),
        )
    )
    db.commit()
    assert (
        client.get("/api/mentor/coach", headers=as_()).json()["today"]["missed_yesterday"] is False
    )


# --- the chat -------------------------------------------------------------------------------


def tool_cards(client: TestClient, message: str) -> list[dict[str, Any]]:
    import json

    response = client.post(
        "/api/mentor/chat/stream",
        json={"message": message, "new_conversation": True},
        headers=as_(),
    )
    events = [
        json.loads(line[6:]) for line in response.text.split("\n\n") if line.startswith("data: ")
    ]
    return [e["tool"]["card"] for e in events if "tool" in e and e["tool"]["status"] == "done"]


def test_no_school_tomorrow_is_applied_at_once_and_can_be_undone(client: TestClient) -> None:
    add(client, **SCHOOL)
    # Another block that day stays: only the school was named.
    add(client, title="Тренировка", kind="sport", weekdays=31, start_minute=1080, end_minute=1170)
    cards = tool_cards(client, "Завтра нет школы")
    change = cards[0]
    assert change["type"] == "schedule_saved" and change["added"] == []
    assert [(b["title"], b["on_date"]) for b in change["removed"]] == [("Школа", "2026-11-20")]
    assert cards[1]["type"] == "replies"
    listed = client.get("/api/mentor/schedule", headers=as_()).json()["events"]
    skipped = {e["title"]: e["skipped"] for e in listed}
    assert skipped == {"Школа": ["2026-11-20"], "Тренировка": []}

    undone = client.post("/api/mentor/schedule/undo", json=change["undo"], headers=as_())
    assert undone.status_code == 204
    listed = client.get("/api/mentor/schedule", headers=as_()).json()["events"]
    assert all(e["skipped"] == [] for e in listed)


def test_day_changes_are_checked_before_they_are_made(client: TestClient, db: Session) -> None:
    add(client, **SCHOOL)
    ctx = mentor_tools.ToolContext(db, user_of(db), THURSDAY, UTC_ZONE, [])
    change = mentor_tools.change_day
    assert change(ctx, {"kind": "skip_day", "date": "2026-11-01"}).card is None  # the past
    assert change(ctx, {"kind": "skip_day", "date": "2026-11-22"}).card is None  # Sunday: no school
    pause = mentor_tools.propose_exception(ctx, {"kind": "pause", "date": "2027-03-01"})
    assert pause.card is None  # too far ahead
    bad = {"kind": "one_off", "date": "today", "title": "Врач", "start": "15:00", "end": "14:00"}
    assert change(ctx, bad).card is None
    pause = mentor_tools.propose_exception(
        ctx, {"kind": "pause", "date": "tomorrow", "until": "2027-02-01"}
    )
    assert pause.card is not None and pause.card["until"] == "2026-12-20"  # 31 days at most
    assert pause.result["saved"] is False  # a pause still waits for the tap
    concert = {
        "kind": "one_off",
        "date": "2026-11-21",
        "title": "Концерт",
        "block_kind": "personal",
        "start": "15:00",
        "end": "18:00",
    }
    one_off = change(ctx, concert).card
    assert one_off is not None and one_off["added"] == [
        {
            "title": "Концерт",
            "kind": "personal",
            "weekdays": [5],
            "start_minute": 900,
            "end_minute": 1080,
            "on_date": "2026-11-21",
        }
    ]
    saturday = datetime(2026, 11, 21).date()
    assert [t for t, _ in coach.blocks_on(db, user_of(db), saturday)] == ["Концерт"]
    assert mentor_tools.offer_replies(ctx, {"replies": ["  ", "Да"] + ["x" * 60] * 5}).card == {
        "type": "replies",
        "replies": ["Да", "x" * 40, "x" * 40, "x" * 40],
    }


def test_the_same_activity_twice_in_one_answer_shows_once(db: Session) -> None:
    plan = [{"kind": "vocab", "title": "A1", "minutes": 4, "deckId": "a1-a2"}]
    ctx = mentor_tools.ToolContext(db, None, THURSDAY, UTC_ZONE, plan)  # type: ignore[arg-type]
    parts: list[dict[str, Any]] = []
    for name in ("suggest_activity", "suggest_activity"):
        list(mentor._run_tool(ctx, name, {"kind": "vocab"}, name, parts))
    assert parts[0]["card"]["deck_id"] == "a1-a2" and parts[1]["card"] is None
