"""The components the mentor can put on screen (ADR 0077). The model only chooses which one and,
for a question, its words; the server fills in every fact (times, words, counts) and validates the
whole card against this catalogue before it is sent. The app draws each in its own design."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class DayBlock(BaseModel):
    title: str
    kind: str
    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=1, le=1440)


class DayCard(BaseModel):
    """Today on a line: blocks, the study time, the kind of day. The app places the tasks."""

    type: Literal["day"] = "day"
    date: str
    blocks: list[DayBlock]
    study_start: int | None
    day_type: str | None


class Word(BaseModel):
    en: str
    l1: str


class WordsCard(BaseModel):
    """A warm-up: words due for review, to recall before starting the real review."""

    type: Literal["words"] = "words"
    words: Annotated[list[Word], Field(min_length=1, max_length=5)]
    due: int = Field(ge=1)


class DayCheckCard(BaseModel):
    type: Literal["day_check"] = "day_check"
    current: str | None


class ChoiceCard(BaseModel):
    """One question, two to four answers; a tap sends the answer as the learner's message."""

    type: Literal["choice"] = "choice"
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    options: Annotated[list[Short], Field(min_length=2, max_length=4)]


class Milestone(BaseModel):
    kind: Literal["streak_weeks", "days_this_week", "words_known"]
    value: int = Field(ge=1)


class CelebrateCard(BaseModel):
    """Only milestones that are true; nothing to celebrate means no card."""

    type: Literal["celebrate"] = "celebrate"
    milestones: Annotated[list[Milestone], Field(min_length=1, max_length=3)]


GenCard = Annotated[
    DayCard | WordsCard | DayCheckCard | ChoiceCard | CelebrateCard, Field(discriminator="type")
]
COMPONENTS = ("day", "words", "day_check", "choice", "celebrate")
