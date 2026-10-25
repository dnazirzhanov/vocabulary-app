"""API contracts for decks, sessions, attempts and summaries. Answer keys never appear in outputs
until the learner has answered."""

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


class DeckOut(BaseModel):
    id: str
    title: str
    description: str
    word_count: int
    introduced_count: int


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
    IntroduceExercise | ChooseMeaningExercise | TypeWordExercise, Field(discriminator="type")
]


class AttemptResultOut(BaseModel):
    exercise_id: str
    # None for introductions, which are acknowledgements rather than answers.
    correct: bool | None
    correct_option_id: str | None = None
    answer: WordOut


class SessionOut(BaseModel):
    id: UUID
    kind: Literal["new", "practice"]
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


StartSessionIn = Annotated[StartNewSession | StartPracticeSession, Field(discriminator="kind")]


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


class SummaryOut(BaseModel):
    session_id: UUID
    kind: Literal["new", "practice"]
    deck_id: str
    words: list[SummaryWord]
    answers_total: int
    answers_correct: int
