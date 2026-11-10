"""The study pack (ADR 0062): what a device needs to plan, schedule and check lessons by itself.

Rows that come by the hundred are arrays, in the order their comments give, to keep it small.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class PackWord(BaseModel):
    id: str
    headword: str
    pos: str
    translation: str
    example: str
    example_translation: str | None
    language: str
    illustration: str | None


class PackPace(BaseModel):
    """A deck's pace inputs (`pace.day_plan`); the device works out the day from them."""

    # New words a day: the course's pace for its levels, else the deck's own.
    daily_new: int
    # A group's «Выучить к» for this deck, the earliest.
    due_on: date | None
    # Extra new words for one day only.
    extra_day: date | None
    extra_words: int


# course: a level of the course; mine: a deck I wrote; group: given to a group of mine.
DeckKind = Literal["course", "mine", "group"]


class PackDeck(BaseModel):
    id: str
    kind: DeckKind
    title: str
    level: str | None
    level_order: int | None
    # A group's deck: the group that gave it, and its author (None once they left).
    group_name: str | None
    author: str | None
    # In deck order.
    word_ids: list[str]
    pace: PackPace
    # Given to one of my groups: a course level then is open, whatever level I am on (ADR 0065).
    given: bool = False


# word id, FSRS state, step, stability, difficulty, due, last review, introduced, first recalled,
# lapses
PackProgress = tuple[
    str,
    int,
    int | None,
    float | None,
    float | None,
    datetime,
    datetime | None,
    datetime,
    datetime | None,
    int,
]
# word id, rung, due, last spelled
PackSpelled = tuple[str, int, datetime, datetime]


class PackIntroduced(BaseModel):
    """New words met on a day of the learner's (today and yesterday), per pace: 'course' for the
    course's levels together, else a deck's id."""

    scope: str
    day: date
    words: int


class StudyPackOut(BaseModel):
    time_zone: str
    course_open: bool
    # The course's ramp (`pace.ramp_week`): on, and the learner's first day.
    ramp_enabled: bool
    started_on: date | None
    decks: list[PackDeck]
    words: list[PackWord]
    progress: list[PackProgress]
    ladder: list[PackSpelled]
    introduced: list[PackIntroduced]
