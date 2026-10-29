"""API contracts for friend groups and their weekly board (ADR 0011). Members are identified by a
nickname and a member id only: never an e-mail or a user id."""

from datetime import date, datetime
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
    # Null for members with no answers yet this week: they are listed without a place.
    rank: int | None
    # Days this week with the member's own plan done, against the days they promised (ADR 0015).
    plan_days: int
    promised_days: int
    # Monday … Sunday of the group's week: was the plan done that day?
    week: list[bool]
    # Weeks in a row with the promise kept.
    streak_weeks: int


class GroupGoal(BaseModel):
    """Co-operative: new words met by everyone this week within their own plans (extra words do
    not count), against everyone's plans combined."""

    done: int
    target: int


class AssignmentMemberOut(BaseModel):
    member_id: UUID
    # Words of the deck this member has met, and of those the ones they now remember well
    # (FSRS stability ≥ 21 days, as on the progress page).
    met: int
    known: int


class GroupProgressOut(BaseModel):
    """The whole group on one deck, for every member: co-operative, like the week's shared goal."""

    # Words met by everyone together, against every member meeting every word.
    met: int
    total: int
    # Members who have met every word of it, out of all members.
    finished: int
    learners: int


class AssignmentOut(BaseModel):
    """A deck given to the group (ADR 0017). It never changes a place on the board: everyone
    meets its words within their own daily pace."""

    deck_id: str
    title: str
    # Its author's nickname in the group (None once they left), and whether that is me.
    author: str | None
    is_mine: bool
    word_count: int
    assigned_at: datetime
    # Words of it I have met (whoever gave it learns it too).
    mine: int
    group: GroupProgressOut
    # Every member's counts, for the group's owner only; null for everyone else.
    members: list[AssignmentMemberOut] | None


class BoardOut(BaseModel):
    group: GroupOut
    week_start: date
    week_end: date
    rows: list[BoardRow]
    goal: GroupGoal
    assignments: list[AssignmentOut]
