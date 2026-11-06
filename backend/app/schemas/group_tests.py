"""API contracts for a group's spelling tests (ADR 0046). A running attempt carries one question at
a time, by its key: never a word's id, which can be the word itself, and never the word."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.learning import SpellingExercise

AttemptKind = Literal["test", "practice"]


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SaveTestIn(_Input):
    # None: every word not excluded.
    question_count: Annotated[int, Field(ge=1)] | None = None
    excluded_word_ids: list[Annotated[str, StringConstraints(max_length=64)]] = Field(
        default_factory=list, max_length=1000
    )
    pass_percent: Annotated[int, Field(ge=1, le=100)] = 80
    minutes: Annotated[int, Field(ge=1, le=180)] = 10
    # Other words mean the results so far no longer compare, so erasing them must be asked for.
    reset: bool = False


class OpenTestIn(_Input):
    open: bool


class StartAttemptIn(_Input):
    kind: AttemptKind


class AnswerIn(_Input):
    question_id: Annotated[str, StringConstraints(min_length=1, max_length=12)]
    answer: Annotated[str, StringConstraints(min_length=1, max_length=80)]


class SkipIn(_Input):
    question_id: Annotated[str, StringConstraints(min_length=1, max_length=12)]
    # The word has come back: skipping it now is final.
    again: bool = False


class ScoreOut(BaseModel):
    correct: int
    total: int
    passed: bool


class TestDeckOut(BaseModel):
    """A deck of the group, in the list of its tests."""

    deck_id: str
    title: str
    # Whether a test has been saved for it, and if so whether it can be started.
    has_test: bool
    is_open: bool
    # My latest result, and whether this opening still has an attempt for me.
    mine: ScoreOut | None
    can_start: bool


class TestsOut(BaseModel):
    can_manage: bool
    decks: list[TestDeckOut]


class TestSettingsOut(BaseModel):
    words: int
    minutes: int
    pass_percent: int
    is_open: bool


class ResultRowOut(BaseModel):
    member_id: UUID
    nickname: str
    is_me: bool
    # None: not taken yet.
    score: ScoreOut | None


class MyTestOut(BaseModel):
    state: Literal["none", "running", "done"]
    attempt_id: UUID | None
    deadline_at: datetime | None
    # My latest result, whichever opening it came from.
    score: ScoreOut | None
    # The test is open and I have an attempt left in this opening.
    can_start: bool
    # An unfinished practice to go back to.
    practice_attempt_id: UUID | None


class TestDetailOut(BaseModel):
    deck_id: str
    title: str
    can_manage: bool
    test: TestSettingsOut | None
    passed: list[ResultRowOut]
    failed: list[ResultRowOut]
    not_taken: list[ResultRowOut]
    mine: MyTestOut


class SetupWordOut(BaseModel):
    id: str
    headword: str
    translation: str


class TestSetupOut(BaseModel):
    """For whoever sets the test up: the only place word ids reach the web."""

    title: str
    words: list[SetupWordOut]
    saved: bool
    question_count: int | None
    excluded_word_ids: list[str]
    pass_percent: int
    minutes: int
    # Timed attempts that a change of words would erase.
    results: int


class MistakeOut(BaseModel):
    translation: str
    word: str
    # None: never answered, because it was skipped or the time ran out first.
    answer: str | None
    skipped: bool


class AttemptResultOut(BaseModel):
    correct: int
    total: int
    # Practice has no pass mark.
    passed: bool | None
    pass_percent: int | None
    timed_out: bool
    mistakes: list[MistakeOut]


class TestAttemptOut(BaseModel):
    id: UUID
    kind: AttemptKind
    deck_id: str
    title: str
    # Words answered or skipped at least once, for the progress bar.
    answered: int
    total: int
    deadline_at: datetime | None
    # The word has been skipped once and has come back.
    returning: bool
    # Exactly one of these: the next word, or how it went.
    question: SpellingExercise | None
    result: AttemptResultOut | None
