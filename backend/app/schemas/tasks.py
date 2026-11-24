"""API contracts for «Планы» (ADR 0084)."""

import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(max_length=2000)]
Minute = Annotated[int, Field(ge=0, le=1439)]
Mask = Annotated[int, Field(ge=0, le=127)]
Priority = Annotated[int, Field(ge=0, le=3)]
Kind = Literal["task", "study"]
MarkState = Literal["done", "skipped"]


class TaskIn(BaseModel):
    title: Title
    notes: Notes = ""
    due_on: date | None = None
    start_minute: Minute | None = None
    repeat_mask: Mask = 0
    priority: Priority = 0
    kind: Kind = "task"


class TaskPatch(BaseModel):
    """Only the fields sent change; null clears a date or a time."""

    title: Title | None = None
    notes: Notes | None = None
    due_on: date | None = None
    start_minute: Minute | None = None
    repeat_mask: Mask | None = None
    priority: Priority | None = None
    kind: Kind | None = None


class TaskOut(BaseModel):
    id: uuid.UUID
    title: str
    notes: str
    due_on: date | None
    start_minute: int | None
    repeat_mask: int
    repeat_until: date | None
    priority: int
    kind: Kind


class TaskItemOut(BaseModel):
    """A task on a day (or, with no date, in «Входящие»), with how it stands for me."""

    task: TaskOut
    on: date | None
    state: MarkState | None
    overdue: bool = False


class TasksOut(BaseModel):
    today: date
    items: list[TaskItemOut]


class MarkIn(BaseModel):
    state: MarkState = "done"
