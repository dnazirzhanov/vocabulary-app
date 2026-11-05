"""API contracts for friend groups and their weekly board (ADR 0011). Members are identified by a
nickname and a member id only: never an e-mail or a user id."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.me import DayState, TodayState

# What a role may do in a group (ADR 0040); the list a caller may do is `GroupOut.can`.
Action = Literal[
    "rename",
    "give_decks",
    "see_standings",
    "reset_invite",
    "remove_member",
    "transfer_ownership",
    "delete_group",
    "manage_tests",
]

Nickname = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=20)]
GroupName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=40)]


class CreateGroupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: GroupName
    nickname: Nickname


class RenameGroupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: GroupName


class TransferIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    member_id: UUID


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
    # The actions my role allows here (ADR 0040).
    can: list[Action]


class TodayMemberOut(BaseModel):
    nickname: str
    is_me: bool
    studied_today: bool


class BehindOut(BaseModel):
    """A deck with a deadline I am behind on (ADR 0032): the most urgent line of a group's row."""

    title: str
    behind: int
    status: Literal["behind", "not_started"]


class GroupSummaryOut(GroupOut):
    """A group in the list of my groups (ADR 0023): its pulse before opening it."""

    # Today by the promise (ADR 0039): members promised today and those of them who finished a
    # session, and where I am.
    today_promised: int
    today_done: int
    my_today: TodayState
    members: list[TodayMemberOut]
    # The deadline deck I am furthest behind on, if any (ADR 0032).
    behind_for_class: BehindOut | None = None


class GroupPreviewOut(BaseModel):
    """What an invite shows before joining: no member names."""

    name: str
    member_count: int
    already_member: bool


Period = Literal["week", "month", "all"]


class MemberDeckOut(BaseModel):
    """One member on one deck given to the group (ADR 0039): the words they have met, and of those
    the ones they have learned — recalled in a later review, as «знаю» on the progress page."""

    deck_id: str
    title: str
    word_count: int
    met: int
    learned: int


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
    # Weeks in a row with every promised day done.
    # Finished a session today, in the group's day.
    studied_today: bool
    # The report (ADR 0039): this week's seven days, promised days missed this calendar month, and
    # today. Words known (recalled in a later review) and learning (met, not yet known) in all.
    week_states: list[DayState]
    month_misses: int
    promise_today: TodayState
    # The weekdays promised (0 = Monday) and whether the promise is paused today.
    promise_weekdays: list[int]
    paused: bool
    known: int
    learning: int
    # Each deck given to the group, in the order it was given.
    decks: list[MemberDeckOut] = Field(default_factory=list)


class TotalsOut(BaseModel):
    """The whole group over the period: co-operative, never compared."""

    days: int
    learned: int
    cards: int


DeadlineStatus = Literal["done", "on_track", "behind", "not_started"]


class StandingOut(BaseModel):
    """Where one member is against a deck's deadline (ADR 0030): «готово», «успевает»,
    «отстаёт на N слов» or «ещё не начинал». `behind`: words short of an even schedule from the
    day it was given to the day before the deadline (after the deadline: words never met)."""

    status: DeadlineStatus
    behind: int


class AssignmentMemberOut(BaseModel):
    member_id: UUID
    # Words of the deck this member has met, and of those the ones they now remember well
    # (FSRS stability ≥ 21 days, as on the progress page).
    met: int
    known: int
    # Against the deadline, when the deck has one.
    standing: StandingOut | None = None


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
    # With a deadline: my own standing, for every member; the owner also sees how many are on
    # track (done or not behind) out of all members (ADR 0030).
    my_standing: StandingOut | None = None
    on_track: int | None = None
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


class LatestTestOut(BaseModel):
    """The group page's line about tests (ADR 0046): the test last taken, and how it went."""

    title: str
    passed: int
    taken: int


class BoardOut(BaseModel):
    group: GroupOut
    # The group's today, and by the promise how many members were promised it and did it.
    today: date
    today_promised: int
    today_done: int
    week_start: date
    week_end: date
    period: Period
    period_start: date | None
    period_end: date
    rows: list[BoardRow]
    totals: TotalsOut
    assignments: list[AssignmentOut]
    latest_test: LatestTestOut | None = None
