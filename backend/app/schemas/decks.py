"""API contracts for teachers' decks and giving them to a group (ADR 0017)."""

import re
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.learning import WordOut


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
# Lowercase letters; a phrase's words are joined by single spaces, hyphens or apostrophes, which
# a spelling card shows as fixed gaps (ADR 0016).
_HEADWORD = re.compile(r"[a-z]+([ '-][a-z]+)*")


def valid_headword(value: str) -> bool:
    return _HEADWORD.fullmatch(value) is not None


def _headword(value: str) -> str:
    # Checked after trimming and lowercasing, so "Setback " is "setback".
    if not valid_headword(value):
        raise ValueError("letters a-z; a phrase's words joined by one space, hyphen or apostrophe")
    return value


Headword = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, max_length=64),
    AfterValidator(_headword),
]
Pos = Literal["noun", "verb", "adjective", "adverb", "phrase", "other"]
Meaning = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Sentence = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Translation = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class NewDeckIn(_Input):
    """Every deck starts as its author's own; giving it to a group is a separate step (ADR 0019)."""

    title: Title


class RenameDeckIn(_Input):
    title: Title


class DeckWordIn(_Input):
    headword: Headword
    pos: Pos
    translation: Meaning
    example: Sentence
    # The example's Russian translation; optional, shown under the example when present.
    example_ru: Translation = ""


class PublishIn(_Input):
    group_id: UUID
    # «Выучить к»: the group's next class (ADR 0028); none: each member's own pace.
    due_on: date | None = None


class DueIn(_Input):
    due_on: date | None


class GenerateIn(_Input):
    """A teacher's lesson material to draft cards from (ADR 0018). Read once, never stored."""

    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=20_000)]
    count: Literal[5, 10, 15, 20] = 10
    level: Literal["A1", "A2", "B1", "B2", "C1"] = "B1"


Level = Literal["A1", "A2", "B1", "B2", "C1"]


class FillIn(_Input):
    """Words to make full cards from (ADR 0019): the AI writes the rest of each card."""

    words: Annotated[
        list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]],
        Field(min_length=1, max_length=20),
    ]
    level: Level = "B1"


class TopicIn(_Input):
    """A topic to make cards for (ADR 0019): the AI chooses the words a learner needs for it."""

    topic: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
    count: Literal[5, 10, 15, 20] = 10
    level: Level = "B1"


class SuggestIn(_Input):
    headword: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    level: Level = "B1"


class SuggestOut(BaseModel):
    """A card filled in for the manual form, not saved: the learner reviews it first."""

    headword: str
    pos: Literal["noun", "verb", "adjective", "adverb", "phrase", "other"]
    translation: str
    example: str
    example_ru: str
    flags: list[str]
    provider: Literal["deepseek", "demo"]


class TeacherWordOut(BaseModel):
    word: WordOut
    # A course word with the same spelling and part of speech: linked, not copied, so learners
    # never meet it twice; its content is the course's and is not edited here.
    from_course: bool
    # The sentence of the teacher's material it was drafted from (ADR 0018).
    source_sentence: str | None = None
    # What the teacher should check: translation_not_russian, example_without_word, example_long.
    flags: list[str] = []


class AssignedGroupOut(BaseModel):
    id: UUID
    name: str
    due_on: date | None = None


class TeacherDeckOut(BaseModel):
    id: str
    title: str
    status: Literal["draft", "published"]
    created_at: datetime
    words: list[TeacherWordOut]
    # Groups it is given to now.
    groups: list[AssignedGroupOut]
    # Topics it has been grown with, the latest first (ADR 0019).
    topics: list[str] = []


class SkippedOut(BaseModel):
    headword: str
    # duplicate (already in the deck), invalid (not a headword we can spell), too_long, full
    reason: Literal["duplicate", "invalid", "too_long", "full"]


class GenerateOut(BaseModel):
    deck: TeacherDeckOut
    added: int
    skipped: list[SkippedOut]
    # "demo": placeholder cards, made without any service.
    provider: Literal["deepseek", "demo"]


class LibraryDeckOut(BaseModel):
    """A deck in «Мои колоды», with the learner's own counts on it."""

    id: str
    title: str
    word_count: int
    introduced_count: int
    learning_count: int
    review_count: int
    # New words opening it would bring today, within the deck's own pace (ADR 0028).
    new_today: int
    next_due_at: datetime | None
    # A teacher's «Выучить к» for a deck from a group.
    due_on: date | None = None
    # Mine: the groups it is given to. From a group: that group and the author's nickname there.
    groups: list[AssignedGroupOut]
    group_name: str | None = None
    author: str | None = None


class LibraryOut(BaseModel):
    mine: list[LibraryDeckOut]
    from_groups: list[LibraryDeckOut]
