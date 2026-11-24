"""«Планы» (ADR 0084): which tasks fall on which day, and what a learner did with them.

Rules (as in TickTick):
- A task with a date falls on that date; one that repeats falls on its weekdays from its first
  date on, until `repeat_until` if an edit ended the series.
- A one-off task past its date and not done is overdue and stays in view until done, moved or
  deleted. A repeating task's missed days are not piled up as overdue: each day is its own.
- A task with no date waits in «Входящие» until done.
- Done and skipped are marks per day. A one-off is done by any done mark.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Task, TaskMark, User
from app.schemas.tasks import TaskIn, TaskItemOut, TaskOut, TaskPatch

MAX_RANGE_DAYS = 62


def bit(day: date) -> int:
    return 1 << day.weekday()


def falls_on(task: Task, day: date) -> bool:
    """Whether a task is due on a date: its date, or one of its repeat days in its series."""
    if task.deleted_at is not None or task.due_on is None:
        return False
    if not task.repeat_mask:
        return task.due_on == day
    if day < task.due_on or (task.repeat_until is not None and day > task.repeat_until):
        return False
    return bool(task.repeat_mask & bit(day))


def days(start: date, end: date) -> Iterable[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def out(task: Task) -> TaskOut:
    return TaskOut(
        id=task.id,
        title=task.title,
        notes=task.notes,
        due_on=task.due_on,
        start_minute=task.start_minute,
        repeat_mask=task.repeat_mask,
        repeat_until=task.repeat_until,
        priority=task.priority,
        kind=task.kind,
    )


@dataclass(frozen=True)
class Marks:
    """A learner's marks: by (task, day), and the one-offs done on any day."""

    by_day: dict[tuple[uuid.UUID, date], str]
    done_once: set[uuid.UUID]


def _marks(db: Session, user: User, tasks: list[Task]) -> Marks:
    rows = db.execute(
        select(TaskMark.task_id, TaskMark.on, TaskMark.state).where(
            TaskMark.user_id == user.id, TaskMark.task_id.in_([t.id for t in tasks])
        )
    ).all()
    by_day = {(task_id, on): state for task_id, on, state in rows}
    done_once = {task_id for task_id, _, state in rows if state == "done"}
    return Marks(by_day, done_once)


def mine(db: Session, user: User) -> list[Task]:
    return list(db.scalars(select(Task).where(Task.user_id == user.id, Task.deleted_at.is_(None))))


def items(
    tasks: list[Task], marks: Marks, start: date, end: date, today: date
) -> list[TaskItemOut]:
    """What «Планы» shows for [start, end]: each day's tasks; and, when the range reaches today,
    overdue one-offs and «Входящие»."""
    found: list[TaskItemOut] = []
    for task in tasks:
        if task.deleted_at is not None:
            continue
        if task.due_on is None:
            if start <= today <= end:
                state = "done" if task.id in marks.done_once else None
                found.append(TaskItemOut(task=out(task), on=None, state=state))
            continue
        if not task.repeat_mask:
            done = task.id in marks.done_once
            if start <= task.due_on <= end:
                state = "done" if done else marks.by_day.get((task.id, task.due_on))
                found.append(
                    TaskItemOut(
                        task=out(task),
                        on=task.due_on,
                        state=state,
                        overdue=not done and task.due_on < today,
                    )
                )
            elif task.due_on < start and not done and start <= today <= end:
                found.append(TaskItemOut(task=out(task), on=task.due_on, state=None, overdue=True))
            continue
        for day in days(max(start, task.due_on), end):
            if falls_on(task, day):
                state = marks.by_day.get((task.id, day))
                found.append(TaskItemOut(task=out(task), on=day, state=state))
    return found


def listed(db: Session, user: User, start: date, end: date, today: date) -> list[TaskItemOut]:
    if end < start or (end - start).days >= MAX_RANGE_DAYS:
        raise ApiError(422, "bad_range", f"A range is 1 to {MAX_RANGE_DAYS} days")
    tasks = mine(db, user)
    return items(tasks, _marks(db, user, tasks), start, end, today)


def _own(db: Session, user: User, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None or task.user_id != user.id:
        raise ApiError(404, "task_not_found", "No such task")
    return task


def create(db: Session, user: User, body: TaskIn, today: date, now: datetime) -> Task:
    task = Task(
        user_id=user.id,
        created_by=user.id,
        title=body.title,
        notes=body.notes,
        # A repeating task starts today unless told otherwise.
        due_on=body.due_on or (today if body.repeat_mask else None),
        start_minute=body.start_minute,
        repeat_mask=body.repeat_mask,
        priority=body.priority,
        kind=body.kind,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def _apply(task: Task, patch: TaskPatch) -> None:
    for name in patch.model_fields_set:
        setattr(task, name, getattr(patch, name))
    if task.repeat_mask and task.due_on is None:
        raise ApiError(422, "repeat_needs_date", "A repeating task needs a first date")


def update(
    db: Session,
    user: User,
    task_id: uuid.UUID,
    patch: TaskPatch,
    scope: str,
    on: date | None,
    now: datetime,
) -> Task:
    """Change a task. For one that repeats: «all» changes the series; «future» ends it the day
    before `on` and starts a changed one from `on`; «one» skips `on` and makes a one-off for it."""
    task = _own(db, user, task_id)
    repeating = bool(task.repeat_mask)
    whole = scope == "all" or on is None or (scope == "future" and on <= (task.due_on or on))
    if not repeating or whole:
        _apply(task, patch)
        task.updated_at = now
        db.commit()
        db.refresh(task)
        return task
    assert on is not None  # «whole» covers a missing day
    if not falls_on(task, on):
        raise ApiError(422, "not_on_that_day", "The task is not on that day")
    copy = Task(
        user_id=user.id,
        created_by=user.id,
        title=task.title,
        notes=task.notes,
        due_on=on,
        start_minute=task.start_minute,
        repeat_mask=task.repeat_mask if scope == "future" else 0,
        repeat_until=task.repeat_until if scope == "future" else None,
        priority=task.priority,
        kind=task.kind,
        created_at=now,
        updated_at=now,
    )
    _apply(copy, patch)
    db.add(copy)
    db.flush()
    if scope == "future":
        task.repeat_until = on - timedelta(days=1)
        # Marks from that day on move with the new series.
        for moved in db.scalars(
            select(TaskMark).where(TaskMark.task_id == task.id, TaskMark.on >= on)
        ):
            moved.task_id = copy.id
    else:
        _set_mark(db, user, task, on, "skipped", now)
    task.updated_at = now
    db.commit()
    db.refresh(copy)
    return copy


def delete(
    db: Session, user: User, task_id: uuid.UUID, scope: str, on: date | None, now: datetime
) -> None:
    """Delete a task; for one that repeats, «future» ends the series before `on`, «one» skips it."""
    task = _own(db, user, task_id)
    if task.repeat_mask and on is not None and scope == "one":
        _set_mark(db, user, task, on, "skipped", now)
    elif (
        task.repeat_mask
        and on is not None
        and scope == "future"
        and task.due_on
        and on > task.due_on
    ):
        task.repeat_until = on - timedelta(days=1)
    else:
        task.deleted_at = now
    task.updated_at = now
    db.commit()


def _set_mark(db: Session, user: User, task: Task, on: date, state: str, now: datetime) -> None:
    mark = db.scalar(
        select(TaskMark).where(
            TaskMark.task_id == task.id, TaskMark.user_id == user.id, TaskMark.on == on
        )
    )
    if mark is None:
        db.add(TaskMark(task_id=task.id, user_id=user.id, on=on, state=state, at=now))
    else:
        mark.state = state
        mark.at = now


def mark(db: Session, user: User, task_id: uuid.UUID, on: date, state: str, now: datetime) -> None:
    """Done or skipped for a day. A dated one-off is marked on its date; one with no date, on any.
    Marking again is harmless."""
    task = _own(db, user, task_id)
    if task.repeat_mask and not falls_on(task, on):
        raise ApiError(422, "not_on_that_day", "The task is not on that day")
    _set_mark(db, user, task, on, state, now)
    db.commit()


def unmark(db: Session, user: User, task_id: uuid.UUID, on: date) -> None:
    task = _own(db, user, task_id)
    if not task.repeat_mask:
        # A one-off: undone whichever day it was ticked.
        found = db.scalars(
            select(TaskMark).where(TaskMark.task_id == task.id, TaskMark.user_id == user.id)
        )
    else:
        found = db.scalars(
            select(TaskMark).where(
                TaskMark.task_id == task.id, TaskMark.user_id == user.id, TaskMark.on == on
            )
        )
    for row in found:
        db.delete(row)
    db.commit()
