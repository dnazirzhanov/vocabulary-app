"""A group's to-do list (ADR 0085): the teacher sets it, every member sees it in «Планы» and ticks
it for themselves, and the group's board shows who did what this week."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import TaskMark, User
from tests.support import at, named

MONDAY = datetime(2026, 11, 23, 10, 0, tzinfo=UTC)
D = date(2026, 11, 23)


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MONDAY)


def class_with(client: TestClient, *students: str) -> dict[str, Any]:
    made = client.post(
        "/api/groups", json={"name": "7Б"}, headers=named(client, as_("olga"), "Ольга")
    )
    assert made.status_code == 201, made.text
    group: dict[str, Any] = made.json()
    for student in students:
        joined = client.post(
            f"/api/groups/join/{group['invite_code']}",
            headers=named(client, as_(student), student.capitalize()),
        )
        assert joined.status_code == 200, joined.text
    return group


def give(client: TestClient, group: dict[str, Any], who: str = "olga", **body: Any) -> Any:
    return client.post(f"/api/groups/{group['id']}/tasks", json=body, headers=as_(who))


def plans(client: TestClient, who: str, start: date = D, end: date | None = None) -> list[Any]:
    got = client.get(
        "/api/tasks",
        params={"start": start.isoformat(), "end": (end or start).isoformat()},
        headers=as_(who),
    )
    assert got.status_code == 200, got.text
    items: list[Any] = got.json()["items"]
    return items


def board(client: TestClient, group: dict[str, Any], who: str = "olga") -> dict[str, Any]:
    got: dict[str, Any] = client.get(f"/api/groups/{group['id']}/board", headers=as_(who)).json()
    return got


def test_the_teacher_sets_a_task_and_every_member_sees_it(client: TestClient) -> None:
    group = class_with(client, "masha", "petya")
    made = give(client, group, title="Повторять слова", repeat_mask=127, start_minute=19 * 60)
    assert made.status_code == 201
    assert made.json()["group_name"] == "7Б"
    for who in ("masha", "petya", "olga"):
        mine = plans(client, who)
        assert [(i["task"]["title"], i["task"]["group_name"]) for i in mine] == [
            ("Повторять слова", "7Б")
        ]
    # Not in anyone else's.
    assert plans(client, "stranger") == []


def test_only_the_teacher_sets_and_changes_it_members_only_tick(client: TestClient) -> None:
    group = class_with(client, "masha")
    assert give(client, group, who="masha", title="x").status_code == 403
    assert give(client, group, who="stranger", title="x").status_code == 404
    task = give(client, group, title="Прочитать текст", due_on=D.isoformat()).json()
    url = f"/api/tasks/{task['id']}"
    assert client.patch(url, json={"title": "y"}, headers=as_("masha")).status_code == 403
    assert client.delete(url, headers=as_("masha")).status_code == 403
    assert (
        client.put(f"{url}/marks/{D.isoformat()}", json={}, headers=as_("masha")).status_code == 204
    )
    # The teacher changes it for everyone.
    assert (
        client.patch(url, json={"title": "Прочитать текст 2"}, headers=as_("olga")).status_code
        == 200
    )
    assert plans(client, "masha")[0]["task"]["title"] == "Прочитать текст 2"


def test_each_member_ticks_for_themselves(client: TestClient) -> None:
    group = class_with(client, "masha", "petya")
    task = give(client, group, title="Повторять слова", repeat_mask=127).json()
    client.put(f"/api/tasks/{task['id']}/marks/{D.isoformat()}", json={}, headers=as_("masha"))
    assert plans(client, "masha")[0]["state"] == "done"
    assert plans(client, "petya")[0]["state"] is None


def test_the_board_shows_who_did_it_this_week(client: TestClient) -> None:
    group = class_with(client, "masha", "petya")
    daily = give(client, group, title="Повторять слова", repeat_mask=127).json()
    once = give(client, group, title="Эссе", due_on=(D + timedelta(days=2)).isoformat()).json()
    tuesday = D + timedelta(days=1)
    client.put(f"/api/tasks/{daily['id']}/marks/{D.isoformat()}", json={}, headers=as_("masha"))
    client.put(f"/api/tasks/{daily['id']}/marks/{D.isoformat()}", json={}, headers=as_("petya"))
    skip = {"state": "skipped"}
    client.put(
        f"/api/tasks/{daily['id']}/marks/{tuesday.isoformat()}", json=skip, headers=as_("petya")
    )
    client.put(f"/api/tasks/{once['id']}/marks/{D.isoformat()}", json={}, headers=as_("masha"))

    seen = board(client, group, who="masha")  # members see it too
    members = {row["name"]: row["member_id"] for row in seen["rows"]}
    by_title = {t["task"]["title"]: t for t in seen["tasks"]}
    week = by_title["Повторять слова"]
    assert week["on_today"] is True and week["week"] == [True] * 7
    assert week["marks"][members["Masha"]][:2] == ["done", None]
    assert week["marks"][members["Petya"]][:2] == ["done", "skipped"]
    essay = by_title["Эссе"]
    assert essay["on_today"] is False and essay["week"] == [
        False,
        False,
        True,
        False,
        False,
        False,
        False,
    ]
    # Done early (on Monday, for Wednesday): shown on the day it was done, never ahead (ADR 0095).
    assert essay["marks"][members["Masha"]] == ["done"] + [None] * 6
    assert essay["marks"][members["Petya"]] == [None] * 7


def test_a_deleted_group_task_leaves_everyones_list(client: TestClient) -> None:
    group = class_with(client, "masha")
    task = give(client, group, title="Прочитать текст", due_on=D.isoformat()).json()
    assert client.delete(f"/api/tasks/{task['id']}", headers=as_("olga")).status_code == 204
    assert plans(client, "masha") == []
    assert board(client, group)["tasks"] == []


def test_a_day_still_to_come_cant_be_done_and_an_old_early_tick_doesnt_count(
    client: TestClient, db: Session
) -> None:
    """26 Nov 2026: a student ticked tomorrow's «Learn new words» and the board showed tomorrow as
    done. A repeat's day is done on that day or later; skipping ahead stays possible (ADR 0095)."""
    group = class_with(client, "masha")
    daily = give(client, group, title="Повторять слова", repeat_mask=127).json()
    tomorrow = (D + timedelta(days=1)).isoformat()
    url = f"/api/tasks/{daily['id']}/marks/{tomorrow}"
    refused = client.put(url, json={}, headers=as_("masha"))
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "not_yet"
    assert client.put(url, json={"state": "skipped"}, headers=as_("masha")).status_code == 204
    client.delete(url, headers=as_("masha"))

    # One made before this rule (written straight in, as the old app could): ignored, kept.
    masha = db.scalars(select(User).where(User.auth_subject.endswith("masha"))).one()
    db.add(
        TaskMark(
            task_id=uuid.UUID(daily["id"]),
            user_id=masha.id,
            on=D + timedelta(days=1),
            state="done",
            at=MONDAY,
        )
    )
    db.commit()
    seen = board(client, group, who="olga")
    members = {row["name"]: row["member_id"] for row in seen["rows"]}
    assert seen["tasks"][0]["marks"][members["Masha"]][:2] == [None, None]
    mine = plans(client, "masha", start=D, end=D + timedelta(days=1))
    assert [(i["on"], i["state"]) for i in mine] == [(D.isoformat(), None), (tomorrow, None)]

    # Tomorrow, on her own clock, it can be done; and the old tick, once its day began, counts.
    on_tuesday = {"X-Dev-User": "masha"} | at(MONDAY + timedelta(days=1))
    assert client.put(url, json={}, headers=on_tuesday).status_code == 204


def test_each_member_on_their_own_clock(client: TestClient) -> None:
    # 22:30 UTC on Monday is already Tuesday in Bishkek: Tuesday's day can be done there.
    group = class_with(client, "masha")
    daily = give(client, group, title="Повторять слова", repeat_mask=127).json()
    late = datetime(2026, 11, 23, 22, 30, tzinfo=UTC)
    tuesday = (D + timedelta(days=1)).isoformat()
    in_bishkek = {"X-Dev-User": "masha"} | at(late, "Asia/Bishkek")
    in_utc = {"X-Dev-User": "masha"} | at(late, "UTC")
    url = f"/api/tasks/{daily['id']}/marks/{tuesday}"
    assert client.put(url, json={}, headers=in_utc).status_code == 422
    assert client.put(url, json={}, headers=in_bishkek).status_code == 204
