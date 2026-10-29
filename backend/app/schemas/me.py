"""API contracts for the learner's own settings and daily pace (ADR 0010)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MeOut(BaseModel):
    # Null until the learner has chosen a pace (first-run screens).
    daily_target_words: int | None
    study_days_per_week: int
    ramp_enabled: bool
    onboarded: bool


class MeUpdate(BaseModel):
    """Only the fields sent are changed."""

    model_config = ConfigDict(extra="forbid")

    daily_target_words: int | None = Field(default=None, ge=1, le=100)
    study_days_per_week: int | None = Field(default=None, ge=1, le=7)
    ramp_enabled: bool | None = None


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


class DismissIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["lower", "raise"]
