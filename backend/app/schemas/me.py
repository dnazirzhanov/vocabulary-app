"""API contracts for the learner's own settings and daily pace (ADR 0010)."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

# One day of a member's promise (ADR 0039): done; missed (promised, over, nothing finished); today,
# still open; later (promised, to come); off (not promised, or paused).
# The languages the app's text comes in (ADR 0055).
UiLanguage = Literal["ru", "uz", "kk", "ky", "tg", "en"]
# The languages a card's meaning comes in. English is what's learned, so it isn't one of them.
CardLanguage = Literal["ru", "uz", "kk", "ky", "tg"]

DayState = Literal["done", "missed", "today", "later", "off"]
# Today for one member: done (a session finished), pending (promised, not yet), off.
TodayState = Literal["done", "pending", "off"]


class PendingPromiseOut(BaseModel):
    """A change made earlier that starts on `effective_from` (tomorrow, at the soonest)."""

    effective_from: date
    weekdays: list[int]


class PauseOut(BaseModel):
    from_date: date
    until_date: date


class PromiseOut(BaseModel):
    """The learner's promise (ADR 0039): the weekdays in force today (0 = Monday … 6 = Sunday), a
    change waiting for tomorrow, and a pause."""

    weekdays: list[int]
    pending: PendingPromiseOut | None
    pause: PauseOut | None


class PromiseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekdays: Annotated[list[Annotated[int, Field(ge=0, le=6)]], Field(min_length=1, max_length=7)]

    @field_validator("weekdays")
    @classmethod
    def _distinct(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("weekdays must be distinct")
        return value


class PauseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    until: date


class MeOut(BaseModel):
    # Shown in every group I am in (ADR 0057); null until the first run asks it.
    name: str | None
    # Null until the learner has chosen a pace (first-run screens).
    daily_target_words: int | None
    study_days_per_week: int
    ramp_enabled: bool
    # The app's language; null until this account has one (ADR 0055).
    ui_language: UiLanguage | None
    # What new decks are translated into; null until asked, the first question (ADR 0055).
    language: CardLanguage | None
    # Which notifications the learner wants (ADR 0042).
    notify_morning: bool
    notify_afternoon: bool
    notify_report: bool
    notify_deadline: bool
    onboarded: bool
    # When the pace was first chosen: the ramp's weeks count from here.
    onboarded_at: datetime | None
    promise: PromiseOut


class MeUpdate(BaseModel):
    """Only the fields sent are changed."""

    model_config = ConfigDict(extra="forbid")

    daily_target_words: int | None = Field(default=None, ge=1, le=100)
    study_days_per_week: int | None = Field(default=None, ge=1, le=7)
    ramp_enabled: bool | None = None
    notify_morning: bool | None = None
    notify_afternoon: bool | None = None
    notify_report: bool | None = None
    notify_deadline: bool | None = None
    ui_language: UiLanguage | None = None
    language: CardLanguage | None = None
    # Checked by `names.clean_name`; the limit here only keeps a long body out.
    name: Annotated[str, StringConstraints(max_length=60)] | None = None


class WordingReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class SuggestionOut(BaseModel):
    kind: Literal["lower", "raise"]
    value: int
    reason: Literal["missed_target", "low_recall", "steady"]
    # The evidence, so the message can say why: new words per learning day, or recall in reviews.
    achieved_per_day: float | None
    recall_percent: int | None


class PaceOut(BaseModel):
    deck_id: str
    target: int
    # Lower than `target` during the first two weeks of a large target (the ramp).
    effective_target: int
    ramp_week: int | None
    new_words_today: int
    remaining_today: int
    # Words in the next new lesson: what is left of today's target, or a bonus lesson after it.
    next_lesson_size: int
    bonus: bool
    # New words wait while this many reviews are due (about two days' worth at this pace).
    blocked_by_reviews: bool
    due_count: int
    review_debt_limit: int
    # The learner's median answering time (a default until there is enough history).
    seconds_per_exercise: float
    suggestion: SuggestionOut | None
    # The pace is the course's (every level shares it) or this deck's own (ADR 0028).
    course: bool
    # A teacher's «Выучить к» and today's share of the words left; extra words taken for today.
    deadline: date | None
    deadline_share: int
    extra_today: int


class DeckPaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    daily_new: Annotated[int, Field(ge=1, le=100)]


class ExtraIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    words: Annotated[int, Field(ge=1, le=100)]


class DismissIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["lower", "raise"]
