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


class TodayMemberOut(BaseModel):
    nickname: str
    is_me: bool
    studied_today: bool


class GroupSummaryOut(GroupOut):
    """A group in the list of my groups (ADR 0023): its pulse before opening it."""

    # My place this week by words learned (null: nothing done yet this week), among the ranked.
    my_rank: int | None
    ranked: int
    members: list[TodayMemberOut]


class GroupPreviewOut(BaseModel):
    """What an invite shows before joining: no member names."""

    name: str
    member_count: int
    already_member: bool


Period = Literal["week", "month", "all"]


class BoardRow(BaseModel):
    member_id: UUID
    nickname: str
    role: Literal["owner", "member"]
    is_me: bool
    # Over the period: words learned (first recalled in a later review), days studied (a session
    # finished, ADR 0027), cards answered.
    learned: int
    days: int
    cards: int
    # The place by words learned, then days studied, then weeks in a row (ADR 0027); null with
    # nothing answered in the period. Equal values share a place.
    rank: int | None
    # This week, whatever the period: days promised, and Monday … Sunday studied.
    promised_days: int
    week: list[bool]
    # Weeks in a row with the promise kept.
    streak_weeks: int
    # Finished a session today, in the member's own day.
    studied_today: bool


class TotalsOut(BaseModel):
    """The whole group over the period: co-operative, never compared."""

    days: int
    learned: int
    cards: int


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
    meets its words within their own daily pace, or by its deadline (ADR 0028)."""

    deck_id: str
    title: str
    due_on: date | None
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
    period: Period
    period_start: date | None
    period_end: date
    rows: list[BoardRow]
    totals: TotalsOut
    assignments: list[AssignmentOut]
