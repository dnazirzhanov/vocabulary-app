"""API contracts for «Планы» (ADR 0084)."""

import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(max_length=2000)]
Minute = Annotated[int, Field(ge=0, le=1439)]
EndMinute = Annotated[int, Field(ge=1, le=1440)]
Mask = Annotated[int, Field(ge=0, le=127)]
Priority = Annotated[int, Field(ge=0, le=3)]
Kind = Literal["task", "study"]
MarkState = Literal["done", "skipped"]


class TaskIn(BaseModel):
    title: Title
    notes: Notes = ""
    due_on: date | None = None
    start_minute: Minute | None = None
    end_minute: EndMinute | None = None
    repeat_mask: Mask = 0
    priority: Priority = 0
    kind: Kind = "task"


class TaskPatch(BaseModel):
    """Only the fields sent change; null clears a date or a time."""

    title: Title | None = None
    notes: Notes | None = None
    due_on: date | None = None
    start_minute: Minute | None = None
    end_minute: EndMinute | None = None
    repeat_mask: Mask | None = None
    priority: Priority | None = None
    kind: Kind | None = None


class TaskOut(BaseModel):
    id: uuid.UUID
    title: str
    notes: str
    due_on: date | None
    start_minute: int | None
    end_minute: int | None = None
    repeat_mask: int
    repeat_until: date | None
    priority: int
    kind: Kind
    # A group's task (ADR 0085): set by its teacher, ticked by each member for themselves.
    group_id: uuid.UUID | None = None
    group_name: str | None = None


class TaskItemOut(BaseModel):
    """A task on a day (or, with no date, in «Входящие»), with how it stands for me."""

    task: TaskOut
    on: date | None
    state: MarkState | None
    overdue: bool = False
    # A study task counted done because the learner practised that day (ADR 0086), not ticked.
    by_practice: bool = False


class TasksOut(BaseModel):
    today: date
    items: list[TaskItemOut]


class MarkIn(BaseModel):
    state: MarkState = "done"


class GroupTaskOut(BaseModel):
    """A group's task on its board (ADR 0085): which days of the group's week it is on, and each
    member's mark on each of them."""

    task: TaskOut
    on_today: bool
    # Seven booleans, the group's week from Monday: whether the task falls on that day.
    week: list[bool]
    # member_id → seven marks («done», «skipped» or null), the same days.
    marks: dict[str, list[MarkState | None]]
