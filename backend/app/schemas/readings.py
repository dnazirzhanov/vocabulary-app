"""Texts people add to Reading Mode themselves (round 2), and their categories."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ReadingTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
# Pasted or photographed text; the word limit is checked after it is split into paragraphs.
ReadingText = Annotated[str, StringConstraints(min_length=1, max_length=40_000)]


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NewReadingIn(_Input):
    title: ReadingTitle
    text: ReadingText
    category_id: UUID | None = None


class ReadingChangeIn(_Input):
    """Only the fields sent change; `category_id: null` takes it out of its category."""

    title: ReadingTitle | None = None
    category_id: UUID | None = None


class CategoryIn(_Input):
    name: CategoryName


class CategoryOut(BaseModel):
    id: UUID
    name: str


class ReadingCardOut(BaseModel):
    """A text in the library's list."""

    id: UUID
    title: str
    category_id: UUID | None
    level: str | None
    words: int
    minutes: int
    # Its meanings are being written (a tap shows them once ready), or that failed.
    status: Literal["drafting", "ready", "failed"]
    created_at: datetime
    # How many questions it asks (none until its meanings are ready).
    questions_count: int = 0


class QuestionOut(BaseModel):
    """A question, as the library's articles carry theirs: with options and the right one's place
    (`choice`), or open, with word limits."""

    id: str
    kind: Literal["choice", "open"]
    q: str
    options: list[str] | None = None
    answer: int | None = None
    min: int | None = None
    max: int | None = None


class ReadingOut(ReadingCardOut):
    """The text as the reader opens it: the library articles' shape, plus its language."""

    body: list[str]
    language: str
    # Word form → {l, p, t, d}: lemma, part of speech (null for a name), meaning, explanation.
    glossary: dict[str, dict[str, str | None]]
    # Drafted with the meanings: none until they are ready.
    questions: list[QuestionOut] = []


class AnswerOut(BaseModel):
    """A reader's latest answer to a question, with the question as it was answered."""

    question_ref: str
    question_text: str
    text: str
    words: int
    sent_at: datetime
    updated_at: datetime
    # A choice question's: the option picked and whether it was right.
    choice: int | None = None
    correct: bool | None = None


class AnswerIn(_Input):
    question_ref: Annotated[str, StringConstraints(max_length=80)]
    # Checked in words (at most 500) once received; the characters only bound the request.
    text: Annotated[str, StringConstraints(max_length=10_000)] = ""
    # A choice question's answer: the option's place.
    choice: Annotated[int, Field(ge=0, le=9)] | None = None


class ReadingListOut(BaseModel):
    categories: list[CategoryOut]
    readings: list[ReadingCardOut]
