"""API contracts for the weekly schedule — the learner's life calendar."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

EventKind = Literal["school", "work", "sport", "chore", "personal", "other"]

EventTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ScheduleEventIn(BaseModel):
    title: EventTitle
    kind: EventKind
    weekdays: Annotated[int, Field(ge=1, le=127)]
    start_minute: Annotated[int, Field(ge=0, le=1439)]
    end_minute: Annotated[int, Field(ge=1, le=1440)]

    @model_validator(mode="after")
    def _end_after_start(self) -> "ScheduleEventIn":
        if self.end_minute <= self.start_minute:
            raise ValueError("end_minute must be greater than start_minute")
        return self


class ScheduleEventOut(BaseModel):
    id: uuid.UUID
    title: str
    kind: EventKind
    weekdays: int
    start_minute: int
    end_minute: int


class ScheduleEventsOut(BaseModel):
    events: list[ScheduleEventOut]
