"""Today's plan bends, the week holds (ADR 0080): «today» carries the learner's local date, so a
device never applies yesterday's choice; and today keeps today's study time when it was changed
for tomorrow (the plan used tomorrow's time before)."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from tests.support import at, finish

BUDAPEST = "Europe/Budapest"
THURSDAY = datetime(2026, 11, 19, 13, 25, tzinfo=UTC)  # 14:25 in Budapest


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")


def as_(moment: datetime, zone: str = BUDAPEST) -> dict[str, str]:
    return {"X-Dev-User": "ann"} | at(moment, zone)


def promise(client: TestClient, moment: datetime, start: int) -> None:
    response = client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": list(range(7)), "start_minute": start, "minutes": 20},
        headers=as_(moment),
    )
    assert response.status_code == 200, response.text


def test_today_keeps_todays_study_time_when_tomorrows_changes(client: TestClient) -> None:
    promise(client, THURSDAY - timedelta(days=9), 21 * 60)
    # A learner with a past: a change waits for tomorrow (one with none yet applies at once).
    lesson = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_(THURSDAY)
    ).json()
    finish(client, lesson, as_(THURSDAY))
    client.post(f"/api/sessions/{lesson['id']}/complete", headers=as_(THURSDAY))
    promise(client, THURSDAY, 7 * 60 + 30)  # from tomorrow
    state = client.get("/api/mentor/coach", headers=as_(THURSDAY)).json()
    assert (state["today"]["study_start"], state["today"]["study_minutes"]) == (21 * 60, 20)
    assert state["commitment"]["start_minute"] == 7 * 60 + 30
    assert state["commitment"]["pending_from"] == "2026-11-20"


def test_today_is_the_learners_own_date(client: TestClient) -> None:
    late = datetime(2026, 11, 19, 23, 30, tzinfo=UTC)  # already Friday 00:30 in Budapest
    assert client.get("/api/mentor/coach", headers=as_(late)).json()["today"]["day"] == (
        "2026-11-20"
    )
    assert client.get("/api/mentor/coach", headers=as_(late, "UTC")).json()["today"]["day"] == (
        "2026-11-19"
    )


def test_no_study_time_on_a_day_off(client: TestClient) -> None:
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": [0, 1, 2], "start_minute": 1260, "minutes": 20},
        headers=as_(THURSDAY - timedelta(days=9)),
    )
    today = client.get("/api/mentor/coach", headers=as_(THURSDAY)).json()["today"]
    assert today["study_start"] is None and today["promised"] is False
