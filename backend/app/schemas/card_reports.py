"""Reports that a card is wrong, and the lists their readers see."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

ReportReason = Literal["translation", "example", "other"]
Note = Annotated[str, StringConstraints(max_length=300)]


class CardReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deck_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    word_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    reason: ReportReason
    note: Note | None = None


class ReportedCardOut(BaseModel):
    word_id: str
    headword: str
    translation: str
    example: str
    # How many learners said each thing is wrong.
    translation_wrong: int
    example_wrong: int
    other: int
    # What they wrote, latest first.
    notes: list[str]
    last_at: datetime


class CardReportsOut(BaseModel):
    cards: list[ReportedCardOut]
