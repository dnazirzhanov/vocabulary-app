"""Texts people add to Reading Mode themselves (round 2), and their categories."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.decks import DeckWordIn, ReadingRef

ReadingTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
# Pasted or photographed text; the word limit is checked after it is split into paragraphs.
ReadingText = Annotated[str, StringConstraints(min_length=1, max_length=40_000)]


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


# The library's topics a text of one's own may be filed under (`Topic` in services/reading.py).
LibraryTopic = Literal[
    "science", "technology", "nature", "society", "psychology", "history", "culture"
]


class NewReadingIn(_Input):
    title: ReadingTitle
    text: ReadingText
    # Filed under a category of mine, or one of the library's topics, or neither: never both.
    category_id: UUID | None = None
    topic: LibraryTopic | None = None

    @model_validator(mode="after")
    def _one_place(self) -> "NewReadingIn":
        if self.category_id is not None and self.topic is not None:
            raise ValueError("a category or a topic, not both")
        return self


class ReadingChangeIn(_Input):
    """Only the fields sent change; `category_id: null` takes it out of its category."""

    title: ReadingTitle | None = None
    category_id: UUID | None = None
    topic: LibraryTopic | None = None


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
    topic: str | None = None
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


# --- a reading given to a group (round 2, D) ----------------------------------------------------


class GiveQuestionIn(_Input):
    """A question as its writer leaves it: with options and the right one's place (two of them,
    «True» and «False», for a true-or-false one), or open, with word limits."""

    # A question kept from before (`question:<id>`): changed in place, its answers kept with it.
    id: Annotated[str, StringConstraints(max_length=80)] | None = None
    kind: Literal["choice", "open"]
    q: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    options: (
        list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]]
        | None
    ) = None
    answer: int | None = None
    min: int | None = Field(default=None, ge=1, le=500)
    max: int | None = Field(default=None, ge=1, le=500)

    @model_validator(mode="after")
    def _whole(self) -> "GiveQuestionIn":
        if self.kind == "choice":
            options = self.options or []
            if not 2 <= len(options) <= 4 or len(set(options)) != len(options):
                raise ValueError("2 to 4 different options")
            if self.answer is None or not 0 <= self.answer < len(options):
                raise ValueError("answer must be an option's place")
        elif self.min is None or self.max is None or self.min > self.max:
            raise ValueError("an open question has min ≤ max")
        return self


class QuestionsIn(_Input):
    """A text's questions as its owner leaves them, in order (round 2: changed, added, dropped)."""

    questions: list[GiveQuestionIn] = Field(max_length=10)


class GiveReadingIn(_Input):
    group_id: UUID
    reading_ref: ReadingRef
    # The words to learn from it: a deck given to the group with it.
    words: list[DeckWordIn] = Field(default_factory=list, max_length=50)
    questions: list[GiveQuestionIn] = Field(default_factory=list, max_length=10)
    due_on: date | None = None


class AssignmentOut(BaseModel):
    """A reading given to one of my groups."""

    id: UUID
    group_id: UUID
    group_name: str
    reading_ref: str
    title: str
    # Who gave it (their name in the group), and whether it was me.
    given_by: str | None
    mine: bool
    # Whether I may take it back: its giver, or the group's owner.
    can_take_back: bool
    deck_id: str | None
    words: int
    due_on: date | None
    given_at: datetime
    questions: list[QuestionOut]


class MemberAnswersOut(BaseModel):
    """A member and their answers to a given reading. Only its giver and the group's owner see
    what was answered; others see who answered how many."""

    name: str | None
    me: bool
    answered: int
    # Seen by the giver and the group's owner only.
    correct: int | None = None
    words_met: int | None = None
    answers: list[AnswerOut] = []


class GivenAnswersOut(BaseModel):
    questions: int
    choice_questions: int
    words: int
    # Whether I see what each member answered (its giver, the group's owner).
    may_see: bool
    members: list[MemberAnswersOut]
