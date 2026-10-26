"""API contracts for decks, sessions, attempts and summaries. Answer keys never appear in outputs
until the learner has answered."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WordOut(BaseModel):
    id: str
    headword: str
    pos: str
    translation: str
    example: str
    example_ru: str
    illustration: str | None


class CourseGoalOut(BaseModel):
    """ "The N most frequent words cover about P% of running text" (sourced in the content)."""

    target_words: int
    coverage_percent: int


class DeckOut(BaseModel):
    id: str
    title: str
    description: str
    course_goal: CourseGoalOut | None
    word_count: int
    introduced_count: int
    due_count: int
    # The earliest upcoming review, when nothing is due yet.
    next_due_at: datetime | None


class PromptWord(BaseModel):
    """What a choose-meaning question shows: everything except the meaning (and the picture)."""

    headword: str
    pos: str
    example: str


class OptionOut(BaseModel):
    id: str
    label: str


class IntroduceExercise(BaseModel):
    id: str
    type: Literal["introduce"] = "introduce"
    word: WordOut


class ChooseMeaningExercise(BaseModel):
    id: str
    type: Literal["choose_meaning"] = "choose_meaning"
    word: PromptWord
    options: list[OptionOut]


class RecallMeaningExercise(BaseModel):
    """Like choose-meaning, but the learner recalls first and asks to see the options."""

    id: str
    type: Literal["recall_meaning"] = "recall_meaning"
    word: PromptWord
    options: list[OptionOut]


class TypePrompt(BaseModel):
    translation: str
    pos: str
    # The English example with the target word blanked out.
    cloze: str | None
    example_ru: str


class TypeWordExercise(BaseModel):
    id: str
    type: Literal["type_word"] = "type_word"
    prompt: TypePrompt


ExerciseOut = Annotated[
    IntroduceExercise | ChooseMeaningExercise | RecallMeaningExercise | TypeWordExercise,
    Field(discriminator="type"),
]

SessionKind = Literal["new", "practice", "review"]


class AttemptResultOut(BaseModel):
    exercise_id: str
    # None for introductions, which are acknowledgements rather than answers.
    correct: bool | None
    correct_option_id: str | None = None
    answer: WordOut


class SessionOut(BaseModel):
    id: UUID
    kind: SessionKind
    deck_id: str
    completed: bool
    exercises: list[ExerciseOut]
    # One per answered exercise, in exercise order; the client resumes after the last one.
    results: list[AttemptResultOut]


class ActiveSessionOut(BaseModel):
    session: SessionOut | None


class StartNewSession(_Input):
    kind: Literal["new"]
    deck_id: Annotated[str, StringConstraints(max_length=64)]


class StartPracticeSession(_Input):
    kind: Literal["practice"]
    source_session_id: UUID


class StartReviewSession(_Input):
    kind: Literal["review"]
    deck_id: Annotated[str, StringConstraints(max_length=64)]


StartRequest = StartNewSession | StartPracticeSession | StartReviewSession
StartSessionIn = Annotated[StartRequest, Field(discriminator="kind")]


class SeenResponse(_Input):
    kind: Literal["seen"]


class ChoiceResponse(_Input):
    kind: Literal["choice"]
    option_id: Annotated[str, StringConstraints(max_length=64)]


class TextResponse(_Input):
    kind: Literal["text"]
    text: Annotated[str, StringConstraints(max_length=100)]


ResponseIn = Annotated[SeenResponse | ChoiceResponse | TextResponse, Field(discriminator="kind")]


class AttemptIn(_Input):
    exercise_id: Annotated[str, StringConstraints(max_length=8)]
    response: ResponseIn


class SummaryWord(BaseModel):
    word: WordOut
    mistakes: int
    # When the word comes back for review (after this session's scheduling).
    next_review_at: datetime


class SummaryOut(BaseModel):
    session_id: UUID
    kind: SessionKind
    deck_id: str
    words: list[SummaryWord]
    answers_total: int
    answers_correct: int
    points: int
    today_points: int
    daily_goal: int


class WordStages(BaseModel):
    introduced: int
    # Introduced but not yet well learned (stages 1-3).
    reviewing: int
    # "Currently well learned": stage >= 4 (ADR 0006).
    well_learned: int
    due: int


class DayActivity(BaseModel):
    date: date
    points: int


class RecallRate(BaseModel):
    """Words recalled in scheduled reviews over the last `days`: delayed recall, not lesson
    answers."""

    recalled: int
    reviewed: int
    days: int


class ProgressOut(BaseModel):
    deck_id: str
    words: WordStages
    today: DayActivity
    daily_goal: int
    streak_days: int
    # The last 7 local days, oldest first.
    week: list[DayActivity]
    recall: RecallRate
    points_total: int
