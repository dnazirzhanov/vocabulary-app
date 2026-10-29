"""API contracts for teachers' decks and giving them to a group (ADR 0017)."""

import re
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

from app.schemas.learning import WordOut


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
# Lowercase letters; a phrase's words are joined by single spaces, hyphens or apostrophes, which
# a spelling card shows as fixed gaps (ADR 0016).
_HEADWORD = re.compile(r"[a-z]+([ '-][a-z]+)*")


def _headword(value: str) -> str:
    # Checked after trimming and lowercasing, so "Setback " is "setback".
    if not _HEADWORD.fullmatch(value):
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
    title: Title
    # The group it is written for: only its owner may make a deck (v1 creators are teachers).
    group_id: UUID


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


class TeacherWordOut(BaseModel):
    word: WordOut
    # A course word with the same spelling and part of speech: linked, not copied, so learners
    # never meet it twice; its content is the course's and is not edited here.
    from_course: bool


class AssignedGroupOut(BaseModel):
    id: UUID
    name: str


class TeacherDeckOut(BaseModel):
    id: str
    title: str
    status: Literal["draft", "published"]
    created_at: datetime
    words: list[TeacherWordOut]
    # Groups it is given to now.
    groups: list[AssignedGroupOut]
