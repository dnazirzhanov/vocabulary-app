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
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Group, GroupMember, Task, TaskMark, User
from app.schemas.tasks import GroupTaskOut, TaskIn, TaskItemOut, TaskOut, TaskPatch
from app.services import group_rights
from app.services.progress import local_day_bounds
from app.services.promise import promise_of, set_weekdays, weekdays_of
from app.services.study_days import days_by_user

MAX_RANGE_DAYS = 62
# The time a study task promises when nothing was promised before (ADR 0086).
STUDY_MINUTES = 20


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


def out(task: Task, group_name: str | None = None) -> TaskOut:
    return TaskOut(
        id=task.id,
        title=task.title,
        notes=task.notes,
        due_on=task.due_on,
        start_minute=task.start_minute,
        end_minute=task.end_minute,
        repeat_mask=task.repeat_mask,
        repeat_until=task.repeat_until,
        priority=task.priority,
        kind=task.kind,
        group_id=task.group_id,
        group_name=group_name,
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
    """My own tasks and my groups' (ADR 0085)."""
    groups = select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    return list(
        db.scalars(
            select(Task).where(
                or_(Task.user_id == user.id, Task.group_id.in_(groups)),
                Task.deleted_at.is_(None),
            )
        )
    )


def group_names(db: Session, tasks: list[Task]) -> dict[uuid.UUID, str]:
    ids = {t.group_id for t in tasks if t.group_id}
    if not ids:
        return {}
    return dict(db.execute(select(Group.id, Group.name).where(Group.id.in_(ids))).tuples().all())


def items(
    tasks: list[Task],
    marks: Marks,
    start: date,
    end: date,
    today: date,
    names: dict[uuid.UUID, str] | None = None,
    practised: set[date] | None = None,
) -> list[TaskItemOut]:
    """What «Планы» shows for [start, end]: each day's tasks; and, when the range reaches today,
    overdue one-offs and «Входящие». A study task with no mark is done on a day the learner
    practised (`practised`, ADR 0086)."""
    found: list[TaskItemOut] = []
    names = names or {}
    practised_days = practised or set()
    for task in tasks:
        if task.deleted_at is not None:
            continue
        shown = out(task, names.get(task.group_id) if task.group_id else None)
        if task.due_on is None:
            if start <= today <= end:
                state = "done" if task.id in marks.done_once else None
                found.append(TaskItemOut(task=shown, on=None, state=state))
            continue
        if not task.repeat_mask:
            practice = (
                task.kind == "study"
                and task.id not in marks.done_once
                and task.due_on in practised_days
            )
            done = task.id in marks.done_once or practice
            if start <= task.due_on <= end:
                state = "done" if done else marks.by_day.get((task.id, task.due_on))
                found.append(
                    TaskItemOut(
                        task=shown,
                        on=task.due_on,
                        state=state,
                        overdue=not done and task.due_on < today,
                        by_practice=practice,
                    )
                )
            elif task.due_on < start and not done and start <= today <= end:
                found.append(TaskItemOut(task=shown, on=task.due_on, state=None, overdue=True))
            continue
        for day in days(max(start, task.due_on), end):
            if falls_on(task, day):
                state = marks.by_day.get((task.id, day))
                practice = task.kind == "study" and state is None and day in practised_days
                found.append(
                    TaskItemOut(
                        task=shown,
                        on=day,
                        state="done" if practice else state,
                        by_practice=practice,
                    )
                )
    return found


def practised(
    db: Session, users: list[User], since: date, zone: ZoneInfo
) -> dict[uuid.UUID, set[date]]:
    """The days each learner finished a session from `since` on: what ticks a study task."""
    found = days_by_user(db, users, local_day_bounds(since, zone)[0], zone)
    return {
        user_id: {d for d, day in by_day.items() if day.studied}
        for user_id, by_day in found.items()
    }


def listed(
    db: Session, user: User, start: date, end: date, today: date, zone: ZoneInfo
) -> list[TaskItemOut]:
    if end < start or (end - start).days >= MAX_RANGE_DAYS:
        raise ApiError(422, "bad_range", f"A range is 1 to {MAX_RANGE_DAYS} days")
    tasks = mine(db, user)
    # Overdue one-offs may be older than the range: their study days are looked up from the oldest.
    since = min([start] + [t.due_on for t in tasks if t.due_on and t.kind == "study"])
    days_done = practised(db, [user], since, zone).get(user.id, set())
    return items(
        tasks, _marks(db, user, tasks), start, end, today, group_names(db, tasks), days_done
    )


def _own(db: Session, user: User, task_id: uuid.UUID, edit: bool = True) -> Task:
    """A task I may change: my own, or my group's if I may manage its tasks. To mark one, being in
    the group is enough. Anyone else's looks like no task at all."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise ApiError(404, "task_not_found", "No such task")
    if task.user_id is not None:
        if task.user_id != user.id:
            raise ApiError(404, "task_not_found", "No such task")
        return task
    role = db.scalar(
        select(GroupMember.role).where(
            GroupMember.group_id == task.group_id, GroupMember.user_id == user.id
        )
    )
    if role is None:
        raise ApiError(404, "task_not_found", "No such task")
    if edit:
        group_rights.require(
            role, "manage_tasks", "not_allowed", "Only the group's teacher sets its tasks"
        )
    return task


def _check_times(start: int | None, end: int | None) -> None:
    if end is not None and (start is None or end <= start):
        raise ApiError(422, "bad_end_time", "The end comes after the start, on the same day")


def create(
    db: Session,
    user: User,
    body: TaskIn,
    today: date,
    now: datetime,
    group_id: uuid.UUID | None = None,
) -> Task:
    _check_times(body.start_minute, body.end_minute)
    task = Task(
        user_id=None if group_id else user.id,
        group_id=group_id,
        created_by=user.id,
        title=body.title,
        notes=body.notes,
        # A repeating task starts today unless told otherwise.
        due_on=body.due_on or (today if body.repeat_mask else None),
        start_minute=body.start_minute,
        end_minute=body.end_minute,
        repeat_mask=body.repeat_mask,
        priority=body.priority,
        kind=body.kind,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    _promise_follows(db, user, task, today)
    return task


def _promise_follows(db: Session, user: User, task: Task, today: date) -> None:
    """A learner's own repeating study task is their promise (ADR 0086): its days and time
    become the promised ones (from tomorrow, as any change of the promise), so the group's report,
    the streaks and the morning reminder follow the planner."""
    if task.user_id != user.id or task.kind != "study" or not task.repeat_mask:
        return
    kept = promise_of(db, user).time_on(today + timedelta(days=1))
    minutes = kept[1] if kept and kept[1] else STUDY_MINUTES
    time = (task.start_minute, minutes) if task.start_minute is not None else None
    set_weekdays(db, user, weekdays_of(task.repeat_mask), today, time)
    db.commit()


def _apply(task: Task, patch: TaskPatch) -> None:
    for name in patch.model_fields_set:
        setattr(task, name, getattr(patch, name))
    if task.repeat_mask and task.due_on is None:
        raise ApiError(422, "repeat_needs_date", "A repeating task needs a first date")
    # Clearing the start clears the end with it.
    if task.start_minute is None:
        task.end_minute = None
    _check_times(task.start_minute, task.end_minute)


def update(
    db: Session,
    user: User,
    task_id: uuid.UUID,
    patch: TaskPatch,
    scope: str,
    on: date | None,
    now: datetime,
    today: date | None = None,
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
        _promise_follows(db, user, task, today or now.date())
        return task
    assert on is not None  # «whole» covers a missing day
    if not falls_on(task, on):
        raise ApiError(422, "not_on_that_day", "The task is not on that day")
    copy = Task(
        user_id=task.user_id,
        group_id=task.group_id,
        created_by=user.id,
        title=task.title,
        notes=task.notes,
        due_on=on,
        start_minute=task.start_minute,
        end_minute=task.end_minute,
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
    _promise_follows(db, user, copy, today or now.date())
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
    task = _own(db, user, task_id, edit=False)
    if task.repeat_mask and not falls_on(task, on):
        raise ApiError(422, "not_on_that_day", "The task is not on that day")
    _set_mark(db, user, task, on, state, now)
    db.commit()


def unmark(db: Session, user: User, task_id: uuid.UUID, on: date) -> None:
    task = _own(db, user, task_id, edit=False)
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


# --- a group's tasks (ADR 0085) -----------------------------------------------------------


def for_group(
    db: Session, group: Group, member_ids: dict[uuid.UUID, uuid.UUID], week: list[date], today: date
) -> list[GroupTaskOut]:
    """The group's tasks that fall in its week, with each member's mark on each day.
    `member_ids` maps each member's user id to their membership id (the board's key)."""
    tasks = [
        t
        for t in db.scalars(
            select(Task).where(Task.group_id == group.id, Task.deleted_at.is_(None))
        )
        if any(falls_on(t, day) for day in week) or (not t.repeat_mask and t.due_on is None)
    ]
    if not tasks:
        return []
    marks = db.execute(
        select(TaskMark.task_id, TaskMark.user_id, TaskMark.on, TaskMark.state).where(
            TaskMark.task_id.in_([t.id for t in tasks]), TaskMark.user_id.in_(member_ids)
        )
    ).all()
    by = {(task_id, user_id, on): state for task_id, user_id, on, state in marks}
    done_any = {(task_id, user_id) for task_id, user_id, _, state in marks if state == "done"}
    # A study task with no mark is done on a day the member practised (ADR 0086).
    if any(t.kind == "study" for t in tasks):
        users = list(db.scalars(select(User).where(User.id.in_(member_ids))))
        studied = practised(db, users, week[0], ZoneInfo(group.time_zone))
        for task in tasks:
            if task.kind != "study":
                continue
            for user_id in member_ids:
                for day in studied.get(user_id, set()):
                    if falls_on(task, day) and (task.id, user_id, day) not in by:
                        by[(task.id, user_id, day)] = "done"
                        done_any.add((task.id, user_id))
    found: list[GroupTaskOut] = []
    for task in sorted(tasks, key=lambda t: (t.start_minute is None, t.start_minute or 0, t.title)):
        days = [falls_on(task, day) for day in week]
        member_marks: dict[str, list[str | None]] = {}
        for user_id, member_id in member_ids.items():
            if task.repeat_mask:
                member_marks[str(member_id)] = [
                    by.get((task.id, user_id, day)) if on else None
                    for day, on in zip(week, days, strict=True)
                ]
            else:
                # A one-off is done once, whichever day: shown on its day (today, if it has none).
                where = task.due_on or today
                state = "done" if (task.id, user_id) in done_any else None
                member_marks[str(member_id)] = [state if day == where else None for day in week]
        found.append(
            GroupTaskOut(
                task=out(task, group.name),
                on_today=falls_on(task, today) or (not task.repeat_mask and task.due_on is None),
                week=days if task.due_on else [day == today for day in week],
                marks=member_marks,
            )
        )
    return found
