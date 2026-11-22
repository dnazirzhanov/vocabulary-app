"""Weekly schedule CRUD and the tester gate."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from tests.support import at

MOMENT = datetime(2026, 11, 14, 10, 0, tzinfo=UTC)


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


def _enable_mentor(monkeypatch: pytest.MonkeyPatch, pattern: str = "*") -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", pattern)


def test_schedule_requires_tester_flag(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "e2e-mentor-*")
    resp = client.get("/api/mentor/schedule", headers=as_("anna"))
    assert resp.status_code == 403


def test_schedule_create_list_update_delete(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    headers = as_("ben")
    # Empty at first.
    assert client.get("/api/mentor/schedule", headers=headers).json() == {"events": []}
    # Create.
    resp = client.post(
        "/api/mentor/schedule",
        json={
            "title": "School",
            "kind": "school",
            "weekdays": 31,  # Mon-Fri = 1|2|4|8|16
            "start_minute": 480,  # 8:00
            "end_minute": 900,  # 15:00
        },
        headers=headers,
    )
    assert resp.status_code == 201
    event_id = resp.json()["id"]
    # List shows it.
    rows = client.get("/api/mentor/schedule", headers=headers).json()["events"]
    assert len(rows) == 1 and rows[0]["title"] == "School"
    # Update.
    resp = client.put(
        f"/api/mentor/schedule/{event_id}",
        json={
            "title": "Math class",
            "kind": "school",
            "weekdays": 31,
            "start_minute": 480,
            "end_minute": 960,  # 16:00
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Math class"
    assert resp.json()["end_minute"] == 960
    # Delete.
    resp = client.delete(f"/api/mentor/schedule/{event_id}", headers=headers)
    assert resp.status_code == 204
    assert client.get("/api/mentor/schedule", headers=headers).json() == {"events": []}


def test_schedule_rejects_end_before_start(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    resp = client.post(
        "/api/mentor/schedule",
        json={
            "title": "Bad",
            "kind": "school",
            "weekdays": 1,
            "start_minute": 600,
            "end_minute": 500,
        },
        headers=as_("carol"),
    )
    assert resp.status_code == 422


def test_schedule_rejects_bad_weekdays(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    headers = as_("dave")
    for bad in (0, 128, -1):
        resp = client.post(
            "/api/mentor/schedule",
            json={
                "title": "X",
                "kind": "school",
                "weekdays": bad,
                "start_minute": 0,
                "end_minute": 60,
            },
            headers=headers,
        )
        assert resp.status_code == 422, f"weekdays={bad} should be rejected"


def test_schedule_rejects_invalid_kind(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    resp = client.post(
        "/api/mentor/schedule",
        json={
            "title": "X",
            "kind": "nonsense",
            "weekdays": 1,
            "start_minute": 0,
            "end_minute": 60,
        },
        headers=as_("eve"),
    )
    assert resp.status_code == 422


def test_schedule_cannot_edit_other_users_event(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_mentor(monkeypatch)
    # frank creates an event.
    resp = client.post(
        "/api/mentor/schedule",
        json={
            "title": "Frank's thing",
            "kind": "chore",
            "weekdays": 1,
            "start_minute": 60,
            "end_minute": 120,
        },
        headers=as_("frank"),
    )
    assert resp.status_code == 201
    event_id = resp.json()["id"]
    # grace cannot update or delete it.
    resp = client.put(
        f"/api/mentor/schedule/{event_id}",
        json={
            "title": "Hijacked",
            "kind": "chore",
            "weekdays": 1,
            "start_minute": 60,
            "end_minute": 120,
        },
        headers=as_("grace"),
    )
    assert resp.status_code == 404
    resp = client.delete(f"/api/mentor/schedule/{event_id}", headers=as_("grace"))
    assert resp.status_code == 404


def test_schedule_rejects_empty_title(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_mentor(monkeypatch)
    resp = client.post(
        "/api/mentor/schedule",
        json={
            "title": "   ",
            "kind": "school",
            "weekdays": 1,
            "start_minute": 0,
            "end_minute": 60,
        },
        headers=as_("holly"),
    )
    assert resp.status_code == 422
