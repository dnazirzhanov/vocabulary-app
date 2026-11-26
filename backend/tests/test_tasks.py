"""«Планы» (ADR 0084): a learner's to-dos, by day, on their own clock; repeats, overdue ones,
«Входящие», done and skipped, and edits of one day or the rest of a series."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.support import at

# Monday 23 November 2026, 10:00 UTC.
MONDAY = datetime(2026, 11, 23, 10, 0, tzinfo=UTC)
D = date(2026, 11, 23)


def as_(name: str = "ann", moment: datetime = MONDAY, zone: str = "UTC") -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment, zone)


def add(client: TestClient, who: str = "ann", **body: Any) -> dict[str, Any]:
    response = client.post("/api/tasks", json=body, headers=as_(who))
    assert response.status_code == 201, response.text
    out: dict[str, Any] = response.json()
    return out


def listing(
    client: TestClient, start: date = D, end: date | None = None, who: str = "ann", **kw: Any
) -> dict[str, Any]:
    params = {"start": start.isoformat(), "end": (end or start).isoformat()}
    response = client.get("/api/tasks", params=params, headers=as_(who, **kw))
    assert response.status_code == 200, response.text
    out: dict[str, Any] = response.json()
    return out


def titles(listed: dict[str, Any], on: date | None = D) -> list[str]:
    day = on.isoformat() if on else None
    return [i["task"]["title"] for i in listed["items"] if i["on"] == day]


def state_of(listed: dict[str, Any], title: str, on: date = D) -> str | None:
    found = [
        i for i in listed["items"] if i["task"]["title"] == title and i["on"] == on.isoformat()
    ]
    assert found, (title, on)
    state: str | None = found[0]["state"]
    return state


def test_a_task_on_a_day_a_repeat_and_one_with_no_date(client: TestClient) -> None:
    add(client, title="Купить тетрадь", due_on=D.isoformat())
    add(client, title="Английский", start_minute=21 * 60, repeat_mask=127, kind="study")
    add(client, title="Когда-нибудь: фильм")
    week = listing(client, D, D + timedelta(days=6))
    assert week["today"] == D.isoformat()
    # The order on a day is the app's to choose (by time, then priority), not the server's.
    assert set(titles(week)) == {"Купить тетрадь", "Английский"}
    # The repeat is on every day of the week, the one-off only on its day.
    for n in range(1, 7):
        assert titles(week, D + timedelta(days=n)) == ["Английский"]
    # No date: in «Входящие».
    assert titles(week, None) == ["Когда-нибудь: фильм"]


def test_weekdays_only_and_a_series_ending(client: TestClient) -> None:
    weekdays = add(client, title="Школа", repeat_mask=31, due_on=D.isoformat())
    week = listing(client, D, D + timedelta(days=6))
    on = [i["on"] for i in week["items"] if i["task"]["id"] == weekdays["id"]]
    assert on == [(D + timedelta(days=n)).isoformat() for n in range(5)]  # Monday to Friday


def test_done_and_skipped_are_per_day_and_marking_twice_is_harmless(client: TestClient) -> None:
    task = add(client, title="Английский", repeat_mask=127)
    url = f"/api/tasks/{task['id']}/marks/{D.isoformat()}"
    for _ in range(2):
        assert client.put(url, json={"state": "done"}, headers=as_()).status_code == 204
    tomorrow = D + timedelta(days=1)
    skip = f"/api/tasks/{task['id']}/marks/{tomorrow.isoformat()}"
    assert client.put(skip, json={"state": "skipped"}, headers=as_()).status_code == 204
    two = listing(client, D, tomorrow)
    assert state_of(two, "Английский") == "done"
    assert state_of(two, "Английский", tomorrow) == "skipped"
    # Undone: back to nothing.
    assert client.delete(url, headers=as_()).status_code == 204
    assert state_of(listing(client), "Английский") is None
    # A day the repeat isn't on can't be marked.
    weekdays = add(client, title="Школа", repeat_mask=31, due_on=D.isoformat())
    saturday = D + timedelta(days=5)
    bad = client.put(
        f"/api/tasks/{weekdays['id']}/marks/{saturday.isoformat()}", json={}, headers=as_()
    )
    assert bad.status_code == 422


def test_a_one_off_past_its_day_is_overdue_until_done_a_repeat_is_not(
    client: TestClient,
) -> None:
    friday = D - timedelta(days=3)
    late = add(client, title="Сдать эссе", due_on=friday.isoformat())
    add(client, title="Английский", repeat_mask=127, due_on=friday.isoformat())
    today = listing(client)
    overdue = [i for i in today["items"] if i["overdue"]]
    assert [i["task"]["title"] for i in overdue] == ["Сдать эссе"]
    assert overdue[0]["on"] == friday.isoformat()
    # Done on another day: no longer overdue.
    client.put(f"/api/tasks/{late['id']}/marks/{D.isoformat()}", json={}, headers=as_())
    assert not [i for i in listing(client)["items"] if i["overdue"]]


def test_today_is_the_learners_own_day(client: TestClient) -> None:
    # 23:30 UTC on Monday is already Tuesday in Bishkek (UTC+6).
    late = datetime(2026, 11, 23, 23, 30, tzinfo=UTC)
    got = client.get("/api/tasks", headers=as_(moment=late, zone="Asia/Bishkek")).json()
    assert got["today"] == "2026-11-24"


def test_changing_the_rest_of_a_series_keeps_the_past(client: TestClient) -> None:
    task = add(client, title="Английский", repeat_mask=127, start_minute=21 * 60)
    client.put(f"/api/tasks/{task['id']}/marks/{D.isoformat()}", json={}, headers=as_())
    thursday = D + timedelta(days=3)
    changed = client.patch(
        f"/api/tasks/{task['id']}",
        params={"scope": "future", "on": thursday.isoformat()},
        json={"start_minute": 20 * 60},
        headers=as_(),
    )
    assert changed.status_code == 200
    week = listing(client, D, D + timedelta(days=6))
    times = {i["on"]: i["task"]["start_minute"] for i in week["items"]}
    assert times[D.isoformat()] == 21 * 60 and times[thursday.isoformat()] == 20 * 60
    assert len([i for i in week["items"] if i["on"] == thursday.isoformat()]) == 1
    assert state_of(week, "Английский") == "done"  # Monday's tick stays


def test_changing_one_day_of_a_series(client: TestClient) -> None:
    task = add(client, title="Английский", repeat_mask=127, start_minute=21 * 60)
    tuesday = D + timedelta(days=1)
    moved = client.patch(
        f"/api/tasks/{task['id']}",
        params={"scope": "one", "on": tuesday.isoformat()},
        json={"start_minute": 18 * 60},
        headers=as_(),
    ).json()
    two = listing(client, tuesday, tuesday)
    on_tuesday = [i for i in two["items"] if i["on"] == tuesday.isoformat()]
    # The series' Tuesday is skipped; the one-off stands in for it at 18:00.
    states = {i["task"]["id"]: (i["state"], i["task"]["start_minute"]) for i in on_tuesday}
    assert states == {task["id"]: ("skipped", 21 * 60), moved["id"]: (None, 18 * 60)}


def test_deleting_one_day_the_rest_or_all(client: TestClient) -> None:
    task = add(client, title="Английский", repeat_mask=127)
    tuesday, thursday = D + timedelta(days=1), D + timedelta(days=3)
    client.delete(
        f"/api/tasks/{task['id']}",
        params={"scope": "one", "on": tuesday.isoformat()},
        headers=as_(),
    )
    client.delete(
        f"/api/tasks/{task['id']}",
        params={"scope": "future", "on": thursday.isoformat()},
        headers=as_(),
    )
    week = listing(client, D, D + timedelta(days=6))
    on = [(i["on"], i["state"]) for i in week["items"]]
    assert on == [
        (D.isoformat(), None),
        (tuesday.isoformat(), "skipped"),
        ((D + timedelta(days=2)).isoformat(), None),
    ]
    assert client.delete(f"/api/tasks/{task['id']}", headers=as_()).status_code == 204
    assert listing(client, D, D + timedelta(days=6))["items"] == []


def test_one_learners_tasks_are_theirs_alone(client: TestClient) -> None:
    task = add(client, title="Секрет")
    assert listing(client, who="bob")["items"] == []
    for call in (
        client.patch(f"/api/tasks/{task['id']}", json={"title": "x"}, headers=as_("bob")),
        client.delete(f"/api/tasks/{task['id']}", headers=as_("bob")),
        client.put(f"/api/tasks/{task['id']}/marks/{D.isoformat()}", json={}, headers=as_("bob")),
    ):
        assert call.status_code == 404


def test_bad_input_is_refused(client: TestClient) -> None:
    for body in (
        {"title": ""},
        {"title": "x", "start_minute": 1440},
        {"title": "x", "repeat_mask": 128},
        {"title": "x", "priority": 4},
        {"title": "x" * 201},
    ):
        assert client.post("/api/tasks", json=body, headers=as_()).status_code == 422
    too_long = client.get(
        "/api/tasks", params={"start": "2026-01-01", "end": "2026-12-31"}, headers=as_()
    )
    assert too_long.status_code == 422


def test_the_mentor_tab_is_hidden_unless_switched_on(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # «Планы» took its place (ADR 0084): even a mentor tester doesn't see it, until the switch.
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    assert client.get("/api/me", headers=as_()).json()["mentor"] is False
    monkeypatch.setattr(get_settings(), "mentor_tab", True)
    assert client.get("/api/me", headers=as_()).json()["mentor"] is True


def test_a_task_can_have_an_end_time_after_its_start(client: TestClient) -> None:
    # «с 19:00 до 20:00» (ADR 0087).
    task = add(
        client, title="Кружок", due_on=D.isoformat(), start_minute=19 * 60, end_minute=20 * 60
    )
    assert (task["start_minute"], task["end_minute"]) == (19 * 60, 20 * 60)
    for bad in (
        {"title": "x", "end_minute": 600},  # an end with no start
        {"title": "x", "start_minute": 600, "end_minute": 600},  # not after it
        {"title": "x", "start_minute": 600, "end_minute": 1441},
    ):
        assert client.post("/api/tasks", json=bad, headers=as_()).status_code == 422
    url = f"/api/tasks/{task['id']}"
    assert client.patch(url, json={"end_minute": 18 * 60}, headers=as_()).status_code == 422
    # Clearing the time clears its end too.
    cleared = client.patch(url, json={"start_minute": None}, headers=as_()).json()
    assert (cleared["start_minute"], cleared["end_minute"]) == (None, None)
