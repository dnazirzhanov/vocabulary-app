"""The study task (ADR 0086): practising in the app ticks it, a tick or a skip of one's own wins,
and a learner's repeating study task is their promise."""

from datetime import UTC, date, datetime
from typing import Any

from fastapi.testclient import TestClient

from tests.support import at, finish, named

MONDAY = datetime(2026, 11, 23, 10, 0, tzinfo=UTC)
D = date(2026, 11, 23)


def as_(name: str = "ann") -> dict[str, str]:
    return {"X-Dev-User": name} | at(MONDAY)


def lesson(client: TestClient, name: str = "ann") -> None:
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_(name)
    ).json()
    finish(client, session, as_(name))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_(name))


def add(client: TestClient, who: str = "ann", **body: Any) -> dict[str, Any]:
    made = client.post("/api/tasks", json=body, headers=as_(who))
    assert made.status_code == 201, made.text
    out: dict[str, Any] = made.json()
    return out


def today(client: TestClient, who: str = "ann") -> dict[str, dict[str, Any]]:
    got = client.get(
        "/api/tasks", params={"start": D.isoformat(), "end": D.isoformat()}, headers=as_(who)
    ).json()
    return {i["task"]["title"]: i for i in got["items"] if i["on"] == D.isoformat()}


def test_practising_ticks_the_study_task_and_nothing_else(client: TestClient) -> None:
    add(client, title="Английский", kind="study", repeat_mask=127, start_minute=21 * 60)
    add(client, title="Купить тетрадь", due_on=D.isoformat())
    add(client, title="Слова", kind="study", due_on=D.isoformat())
    before = today(client)
    assert before["Английский"]["state"] is None and before["Слова"]["state"] is None
    lesson(client)
    after = today(client)
    assert (after["Английский"]["state"], after["Английский"]["by_practice"]) == ("done", True)
    assert (after["Слова"]["state"], after["Слова"]["by_practice"]) == ("done", True)
    assert after["Купить тетрадь"]["state"] is None


def test_a_skip_of_ones_own_wins_over_practice(client: TestClient) -> None:
    task = add(client, title="Английский", kind="study", repeat_mask=127)
    client.put(
        f"/api/tasks/{task['id']}/marks/{D.isoformat()}", json={"state": "skipped"}, headers=as_()
    )
    lesson(client)
    item = today(client)["Английский"]
    assert (item["state"], item["by_practice"]) == ("skipped", False)


def test_a_repeating_study_task_is_the_promise(client: TestClient) -> None:
    client.get("/api/me", headers=as_())  # a learner with nothing finished: it applies at once
    add(client, title="Купить тетрадь", repeat_mask=127)  # a plain task promises nothing
    before = client.get("/api/me", headers=as_()).json()["promise"]["weekdays"]
    add(client, title="Английский", kind="study", repeat_mask=31, start_minute=20 * 60)
    promise = client.get("/api/me", headers=as_()).json()["promise"]
    assert promise["weekdays"] == [0, 1, 2, 3, 4] != before
    coach_time = client.get("/api/me", headers=as_()).json()
    assert coach_time["promise"]["pending"] is None  # nothing finished yet: no waiting change


def test_the_group_board_counts_practice_too(client: TestClient) -> None:
    made = client.post(
        "/api/groups", json={"name": "7Б"}, headers=named(client, as_("olga"), "Ольга")
    ).json()
    client.post(
        f"/api/groups/join/{made['invite_code']}", headers=named(client, as_("masha"), "Маша")
    )
    client.post(
        f"/api/groups/{made['id']}/tasks",
        json={"title": "Заниматься", "kind": "study", "repeat_mask": 127},
        headers=as_("olga"),
    )
    lesson(client, "masha")
    board = client.get(f"/api/groups/{made['id']}/board", headers=as_("olga")).json()
    masha = next(row["member_id"] for row in board["rows"] if row["name"] == "Маша")
    (task,) = board["tasks"]
    assert task["marks"][masha][0] == "done"  # Monday, today
