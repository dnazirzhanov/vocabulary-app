"""API contracts for friend groups and their weekly board (ADR 0011). Members are identified by a
nickname and a member id only: never an e-mail or a user id."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints

Nickname = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=20)]
GroupName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=40)]


class CreateGroupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: GroupName
    nickname: Nickname


class JoinGroupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nickname: Nickname


class GroupOut(BaseModel):
    id: UUID
    name: str
    invite_code: str
    member_count: int
    role: Literal["owner", "member"]
    nickname: str


class GroupPreviewOut(BaseModel):
    """What an invite shows before joining: no member names."""

    name: str
    member_count: int
    already_member: bool


class BoardRow(BaseModel):
    member_id: UUID
    nickname: str
    role: Literal["owner", "member"]
    is_me: bool
    # Null for members with no points yet this week: they are listed without a place.
    rank: int | None
    days_practised: int
    # Monday … Sunday of the group's week: was the 30-point daily goal met that day?
    week: list[bool]
    points: int
    streak_days: int


class GroupGoal(BaseModel):
    """Co-operative: new words met by everyone this week, against everyone's plans combined."""

    done: int
    target: int


class BoardOut(BaseModel):
    group: GroupOut
    week_start: date
    week_end: date
    rows: list[BoardRow]
    goal: GroupGoal
