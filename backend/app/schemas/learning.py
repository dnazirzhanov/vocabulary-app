"""API contracts for decks, flashcard sessions, ratings and summaries (ADR 0012).

Flashcards are self-graded: the card carries its answer, the learner reveals it and rates their own
recall, and the server schedules the word from that rating."""

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
    # The course level ("A1–A2") and its order; a later level is locked until the one before is
    # done (ADR 0014).
    level: str | None
    level_order: int
    locked: bool
    course_goal: CourseGoalOut | None
    word_count: int
    introduced_count: int
    due_count: int
    # Due cards split as in Anki: still in short learning steps, and long-term reviews.
    learning_count: int
    review_count: int
    # New cards this deck offers today (what is left of the daily pace; 0 on other levels).
    new_today: int
    # The earliest upcoming review, when nothing is due yet.
    next_due_at: datetime | None


class IntervalPreview(BaseModel):
    """When the card comes back if given this rating (shown under the buttons, as in Anki)."""

    rating: int
    seconds: int


class CardExercise(BaseModel):
    id: str
    type: Literal["card"] = "card"
    word: WordOut
    # A word's first showing ever: the back introduces it rather than checking recall.
    new: bool
    previews: list[IntervalPreview]


ExerciseOut = CardExercise

SessionKind = Literal["study", "hard"]


class AttemptResultOut(BaseModel):
    exercise_id: str
    rating: int
    # When the card is due next (practice sessions leave the schedule as it was).
    next_due_at: datetime
    # Another showing of the same card later in this session, when it is due again soon, and its
    # position in the session's exercise list.
    appended: CardExercise | None = None
    appended_index: int | None = None


class SessionOut(BaseModel):
    id: UUID
    kind: SessionKind
    deck_id: str
    completed: bool
    exercises: list[ExerciseOut]
    # One per rated exercise, in exercise order; the client resumes after the last one.
    results: list[AttemptResultOut]


class ActiveSessionOut(BaseModel):
    session: SessionOut | None


class StartStudySession(_Input):
    """One deck: its due cards, then its new words up to today's pace. No deck: every level's
    due cards, then the current level's new words («Продолжить»)."""

    kind: Literal["study"]
    deck_id: Annotated[str, StringConstraints(max_length=64)] | None = None


class StartHardSession(_Input):
    """Extra practice on the learner's hardest words; the schedule is not changed."""

    kind: Literal["hard"]
    deck_id: Annotated[str, StringConstraints(max_length=64)]


StartRequest = StartStudySession | StartHardSession
StartSessionIn = Annotated[StartRequest, Field(discriminator="kind")]


class RatingResponse(_Input):
    kind: Literal["rating"]
    # 1 Снова, 2 Трудно, 3 Хорошо, 4 Легко
    rating: Annotated[int, Field(ge=1, le=4)]


class AttemptIn(_Input):
    exercise_id: Annotated[str, StringConstraints(max_length=8)]
    response: RatingResponse


class SummaryWord(BaseModel):
    word: WordOut
    # The last and the lowest rating this session, and how often the card was shown.
    rating: int
    lowest_rating: int
    showings: int
    next_review_at: datetime


class RatingCounts(BaseModel):
    again: int
    hard: int
    good: int
    easy: int


class SummaryOut(BaseModel):
    session_id: UUID
    kind: SessionKind
    deck_id: str
    words: list[SummaryWord]
    new_words: int
    reviewed_words: int
    ratings: RatingCounts
    points: int
    today_points: int
    daily_goal: int


class WordStages(BaseModel):
    introduced: int
    # Introduced but not yet well learned.
    reviewing: int
    # "Currently well learned": in review with FSRS stability of 21 days or more (ADR 0012).
    well_learned: int
    due: int


class DayActivity(BaseModel):
    date: date
    points: int


class RecallRate(BaseModel):
    """Review cards rated anything but «Снова» over the last `days`: recall after a delay, not
    the first showing of new words."""

    recalled: int
    reviewed: int
    days: int


class ProgressOut(BaseModel):
    """The whole course: where the learner stands on its words and how steadily they practise."""

    words: WordStages
    today: DayActivity
    daily_goal: int
    streak_days: int
    # Days with any points in the last year, oldest first; the calendar fills the gaps with zeros.
    activity: list[DayActivity]
    # The weekly commitment the learner chose (days per week with the daily goal met).
    study_days_per_week: int
    recall: RecallRate


class DeckWordOut(BaseModel):
    """One row of the word list: every word of the deck, with where the learner stands on it."""

    position: int
    word: WordOut
    # not_started: not met yet · new: met, no review yet · learning: in review (stages 1-3)
    # · well_learned: stage >= 4 ("currently well learned", ADR 0006).
    status: Literal["not_started", "new", "learning", "well_learned"]
    next_review_at: datetime | None


class GlossaryEntryOut(BaseModel):
    """What a tapped word in an example shows: its meaning, dictionary form and a short note."""

    ru: str
    lemma: str | None
    note: str | None
