"""API contracts for the weekly schedule — the learner's life calendar."""

import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

EventKind = Literal[
    "school", "work", "sport", "chore", "personal", "other", "rest", "play", "sleep"
]

EventTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ScheduleEventIn(BaseModel):
    title: EventTitle
    kind: EventKind
    weekdays: Annotated[int, Field(ge=1, le=127)]
    start_minute: Annotated[int, Field(ge=0, le=1439)]
    end_minute: Annotated[int, Field(ge=1, le=1440)]
    # A block on this date only (ADR 0074); its weekdays become that date's weekday.
    on_date: date | None = None

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
    on_date: date | None = None
    # Dates this repeating block isn't happening, from a week ago on.
    skipped: list[date] = []


class SkipIn(BaseModel):
    date: date


class ScheduleEventsOut(BaseModel):
    events: list[ScheduleEventOut]
