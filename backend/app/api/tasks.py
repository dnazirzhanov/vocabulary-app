"""«Планы» (ADR 0084): a learner's to-dos. Everyone has them; nothing here is a tester's feature."""

import uuid
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.schemas.tasks import MarkIn, TaskIn, TaskOut, TaskPatch, TasksOut
from app.services import group_rights, groups, tasks

router = APIRouter(tags=["tasks"])

Scope = Literal["all", "future", "one"]


@router.get("/tasks")
def list_tasks(
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    start: date | None = None,
    end: date | None = None,
) -> TasksOut:
    """Each day's tasks from `start` to `end` (default: today and the next 6 days), with overdue
    ones and «Входящие» when the range takes in today."""
    today = now.astimezone(time_zone).date()
    first = start or today
    last = end or first + timedelta(days=6)
    return TasksOut(today=today, items=tasks.listed(db, user, first, last, today, time_zone))


@router.post("/tasks", status_code=201)
def create_task(
    body: TaskIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> TaskOut:
    return tasks.out(tasks.create(db, user, body, now.astimezone(time_zone).date(), now))


@router.post("/groups/{group_id}/tasks", status_code=201)
def create_group_task(
    group_id: uuid.UUID,
    body: TaskIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> TaskOut:
    """A task for the whole group (ADR 0085): its teacher sets it, each member ticks their own."""
    group, me = groups.membership(db, user, group_id)
    group_rights.require(
        me.role, "manage_tasks", "not_allowed", "Only the group's teacher sets its tasks"
    )
    task = tasks.create(db, user, body, now.astimezone(time_zone).date(), now, group_id=group.id)
    return tasks.out(task, group.name)


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: uuid.UUID,
    body: TaskPatch,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    scope: Scope = "all",
    on: date | None = None,
) -> TaskOut:
    today = now.astimezone(time_zone).date()
    return tasks.out(tasks.update(db, user, task_id, body, scope, on, now, today))


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(
    task_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    scope: Scope = "all",
    on: date | None = None,
) -> Response:
    tasks.delete(db, user, task_id, scope, on, now)
    return Response(status_code=204)


@router.put("/tasks/{task_id}/marks/{on}", status_code=204)
def mark_task(
    task_id: uuid.UUID,
    on: date,
    body: MarkIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> Response:
    # «Today» is the learner's own (ADR 0095): a day still to come can't be done yet.
    tasks.mark(db, user, task_id, on, body.state, now, now.astimezone(time_zone).date())
    return Response(status_code=204)


@router.delete("/tasks/{task_id}/marks/{on}", status_code=204)
def unmark_task(task_id: uuid.UUID, on: date, user: CurrentUser, db: DbSession) -> Response:
    tasks.unmark(db, user, task_id, on)
    return Response(status_code=204)
