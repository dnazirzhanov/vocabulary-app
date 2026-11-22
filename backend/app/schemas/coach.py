"""The mentor's coach (ADR 0071): what the app sends and gets back."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

GoalKindIn = Literal["ielts", "conversation", "travel", "business", "academic", "general"]


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GoalIn(_Input):
    kind: GoalKindIn
    target: Annotated[str, StringConstraints(strip_whitespace=True, max_length=8)] | None = None
    deadline: date | None = None
    why: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None
    start_level: Literal["A1", "A2", "B1", "B2", "C1", "C2"] | None = None


class GoalOut(BaseModel):
    kind: str
    target: str | None
    deadline: date | None
    why: str | None
    start_level: str | None


class FeasibilityOut(BaseModel):
    status: Literal["on_track", "tight", "not_possible", "open", "reached"]
    hours_needed: int | None
    weeks_left: float | None
    weekly_minutes_needed: int | None
    weekly_minutes: int
    minutes_a_day_needed: int | None
    reached_by: date | None


class TargetOut(BaseModel):
    skill: Literal["words", "reading", "writing", "speaking"]
    minutes: int
    planned: int
    done: int


class CommitmentOut(BaseModel):
    weekdays: list[int]
    start_minute: int | None
    minutes: int | None
    pending_from: date | None


class AdjustmentOut(BaseModel):
    id: uuid.UUID
    kind: Literal["easier_minutes", "fewer_days", "move_time", "more_minutes", "behind"]
    evidence: dict[str, int | None]
    proposal: dict[str, int | None]


class TodayOut(BaseModel):
    """Today against the promise (ADR 0074)."""

    override_mode: Literal["minimum", "moved", "skip"] | None
    override_start: int | None
    studied: bool
    promised: bool
    missed_yesterday: bool
    day_type: Literal["study", "light", "weekend", "sick", "exam"] | None = None
    # The learner's local date this is for, and today's own study time (ADR 0080).
    day: date | None = None
    study_start: int | None = None
    study_minutes: int | None = None


class TodayIn(_Input):
    mode: Literal["minimum", "moved", "skip"]
    start_minute: Annotated[int, Field(ge=0, le=1439)] | None = None


class DayTypeIn(_Input):
    """What kind of day today is (ADR 0076); null clears it."""

    type: Literal["study", "light", "weekend", "sick", "exam"] | None


class CoachOut(BaseModel):
    goal: GoalOut | None
    feasibility: FeasibilityOut | None
    week_start: date
    targets: list[TargetOut]
    # Skills furthest behind this point of the week, most behind first.
    behind: list[str]
    # Monday to Sunday.
    promised: list[bool]
    studied: list[bool]
    commitment: CommitmentOut
    adjustment: AdjustmentOut | None
    today: TodayOut


class StudyTimeOut(BaseModel):
    weekdays: list[int]
    start_minute: int
    minutes: int
    reasons: list[Literal["free", "habit", "preferred", "after_block", "works"]]
    # How often a study time near here was kept when promised (ADR 0076).
    kept: int = 0
    tried: int = 0


class CommitmentIn(_Input):
    weekdays: Annotated[list[Annotated[int, Field(ge=0, le=6)]], Field(min_length=1, max_length=7)]
    start_minute: Annotated[int, Field(ge=0, le=1439)]
    minutes: Annotated[int, Field(ge=5, le=180)]


class DecisionIn(_Input):
    accept: bool


# --- what the mentor knows (ADR 0075) -------------------------------------------------------

FactKindIn = Literal["why", "likes", "dislikes", "constraint", "energy", "word", "other"]


class FactIn(_Input):
    kind: FactKindIn
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    # "chat" when it came from the mentor's «Запомнить?», "user" when written on the page.
    source: Literal["chat", "user"] = "user"


class FactOut(BaseModel):
    id: uuid.UUID
    kind: str
    text: str
    source: str
    created_at: datetime


class TimelineOut(BaseModel):
    at: datetime
    kind: str
    note: dict[str, Any]


class MemoryOut(BaseModel):
    facts: list[FactOut]
    timeline: list[TimelineOut]


class EventIn(_Input):
    """A «Начать» tapped (ADR 0078); the only event the app sends, the rest are the server's."""

    name: Literal["start_tapped"]
    kind: Literal["vocab", "spelling", "reading", "writing", "speaking"]
    where: Literal["home", "chat", "panel"]
