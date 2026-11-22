"""Study, rest, play and priorities (ADR 0076): what kind of day today is, protected rest, play
and sleep blocks, and study times that learn from which promised times were kept."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User, WritingSubmission
from app.services import mentor
from tests.support import at

THURSDAY = datetime(2026, 11, 19, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(moment: datetime = THURSDAY, name: str = "ann") -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


def ann(db: Session) -> User:
    return db.scalars(select(User).where(User.auth_subject == "dev|ann")).one()


def wrote(db: Session, moment: datetime) -> None:
    db.add(
        WritingSubmission(
            user_id=ann(db).id,
            client_id=uuid.uuid4(),
            question_id="q",
            answer="x",
            status="done",
            created_at=moment,
        )
    )
    db.commit()


# --- the kind of day ------------------------------------------------------------------------


def test_the_kind_of_day_is_kept_for_today_only_and_can_be_cleared(client: TestClient) -> None:
    state = client.put("/api/mentor/coach/day-type", json={"type": "light"}, headers=as_())
    assert state.json()["today"]["day_type"] == "light"
    tomorrow = client.get("/api/mentor/coach", headers=as_(THURSDAY + timedelta(days=1)))
    assert tomorrow.json()["today"]["day_type"] is None
    cleared = client.put("/api/mentor/coach/day-type", json={"type": None}, headers=as_())
    assert cleared.json()["today"]["day_type"] is None
    bad = client.put("/api/mentor/coach/day-type", json={"type": "holiday"}, headers=as_())
    assert bad.status_code == 422


def test_a_sick_day_is_never_a_missed_day(client: TestClient) -> None:
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": list(range(7)), "start_minute": 1140, "minutes": 20},
        headers=as_(datetime(2026, 11, 10, 9, tzinfo=UTC)),
    )
    assert client.get("/api/mentor/coach", headers=as_()).json()["today"]["missed_yesterday"]
    client.put(
        "/api/mentor/coach/day-type",
        json={"type": "sick"},
        headers=as_(THURSDAY - timedelta(days=1)),
    )
    today = client.get("/api/mentor/coach", headers=as_()).json()["today"]
    assert today["missed_yesterday"] is False


# --- rest, play, sleep ----------------------------------------------------------------------


def test_rest_play_and_sleep_are_blocks_study_never_goes_into(client: TestClient) -> None:
    for title, kind, start, end in (
        ("Школа", "school", 480, 840),
        ("Отдых", "rest", 840, 960),
        ("Игры", "play", 960, 1140),
        ("Сон", "sleep", 1320, 1440),
    ):
        made = client.post(
            "/api/mentor/schedule",
            json={
                "title": title,
                "kind": kind,
                "weekdays": 31,
                "start_minute": start,
                "end_minute": end,
            },
            headers=as_(),
        )
        assert made.status_code == 201, made.text
    options = client.get(
        "/api/mentor/coach/study-times",
        params={"minutes": 20, "weekdays": [0, 1, 2, 3, 4]},
        headers=as_(),
    ).json()
    assert options
    for option in options:
        start, end = option["start_minute"], option["start_minute"] + option["minutes"]
        for block_start, block_end in ((480, 840), (840, 960), (960, 1140), (1320, 1440)):
            assert end <= block_start or start >= block_end, option


# --- which times work -----------------------------------------------------------------------


def test_a_promised_time_that_is_kept_is_recommended_with_its_record(
    client: TestClient, db: Session
) -> None:
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": list(range(7)), "start_minute": 1140, "minutes": 20},
        headers=as_(datetime(2026, 11, 10, 9, tzinfo=UTC)),
    )
    # Promised 10–18 November at 19:00 (a first promise counts from its own day): kept on six
    # days, sick on the 17th, missed on the other two.
    for day in (11, 12, 13, 14, 15, 16):
        wrote(db, datetime(2026, 11, day, 19, 5, tzinfo=UTC))
    client.put(
        "/api/mentor/coach/day-type",
        json={"type": "sick"},
        headers=as_(datetime(2026, 11, 17, 9, tzinfo=UTC)),
    )
    options = client.get(
        "/api/mentor/coach/study-times",
        params={"minutes": 20, "weekdays": list(range(7))},
        headers=as_(),
    ).json()
    works = [o for o in options if "works" in o["reasons"]]
    assert len(works) == 1 and abs(works[0]["start_minute"] - 1140) <= 30
    assert (works[0]["kept"], works[0]["tried"]) == (6, 8)  # the sick day proves nothing


# --- the mentor knows -----------------------------------------------------------------------


def test_the_prompt_has_todays_kind_of_day_and_only_todays_blocks(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}
    monkeypatch.setattr(get_settings(), "mentor_chat_demo", False)
    monkeypatch.setattr(get_settings(), "deepseek_api_key", "test-key")

    def record(system: str, *_: Any) -> Any:
        seen["system"] = system
        yield {"delta": "ok"}

    monkeypatch.setattr(mentor, "_stream_with_tools", record)
    school = client.post(
        "/api/mentor/schedule",
        json={
            "title": "Школа",
            "kind": "school",
            "weekdays": 31,
            "start_minute": 480,
            "end_minute": 840,
        },
        headers=as_(),
    ).json()
    client.post(
        f"/api/mentor/schedule/{school['id']}/skips", json={"date": "2026-11-19"}, headers=as_()
    )
    # A one-off next Thursday is not today's.
    client.post(
        "/api/mentor/schedule",
        json={
            "title": "Концерт",
            "kind": "personal",
            "weekdays": 8,
            "start_minute": 900,
            "end_minute": 960,
            "on_date": "2026-11-26",
        },
        headers=as_(),
    )
    client.put("/api/mentor/coach/day-type", json={"type": "exam"}, headers=as_())
    client.post("/api/mentor/chat/stream", json={"message": "Что делать?"}, headers=as_())
    assert "Today: exam day: only the 5-minute minimum." in seen["system"]
    assert "Школа" not in seen["system"] and "Концерт" not in seen["system"]
