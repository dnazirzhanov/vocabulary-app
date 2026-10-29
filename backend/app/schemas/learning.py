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
    # 'course': a level. 'group': a deck a teacher gave one of my groups (ADR 0017), listed
    # first: its words come before the course's in the daily lesson.
    kind: Literal["course", "group"]
    # Where a group deck comes from: its group, its author's nickname there (None once they left)
    # and whether I wrote it.
    group_name: str | None = None
    author: str | None = None
    is_mine: bool = False
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


class SpellingPrompt(BaseModel):
    """What a spelling card shows: the meaning, never the English word (no id, example or audio)."""

    translation: str
    pos: str


class SpellingExercise(BaseModel):
    """Build the word from its meaning with letter tiles (ADR 0016)."""

    id: str
    type: Literal["spelling"] = "spelling"
    prompt: SpellingPrompt
    # Letters in the word: the empty slots.
    slots: int
    # A phrase's spaces, hyphens and apostrophes: fixed gaps between slots, never tiles.
    separators: list["SeparatorOut"] = Field(default_factory=list)
    # Letter tiles in display order; the client gives each its own identity by position.
    tiles: list[str]
    # The one hint of this card, once given: a slot and its letter.
    hint: "HintOut | None" = None


class HintIn(_Input):
    """Ask for the letter of the next empty slot (ADR 0016): one per card."""

    position: Annotated[int, Field(ge=0, le=63)]


class HintOut(BaseModel):
    # The slot: the letter's place among the word's letters (separators not counted).
    position: int
    letter: str


class SeparatorOut(BaseModel):
    # How many letters come before it.
    after: int
    char: str


ExerciseOut = Annotated[CardExercise | SpellingExercise, Field(discriminator="type")]


class InsertedExercise(BaseModel):
    """An exercise added to the lesson by an answer, and its position in the exercise list."""

    index: int
    exercise: ExerciseOut


SessionKind = Literal["study", "hard", "spelling"]


class AttemptResultOut(BaseModel):
    exercise_id: str
    # Cards: the rating and when the card is due next (practice leaves the schedule as it was).
    rating: int | None = None
    next_due_at: datetime | None = None
    # Spelling: whether the word was built right at this first try, and the word itself (shown
    # only once answered).
    correct: bool | None = None
    answer: str | None = None
    # Exercises this answer added later in the lesson: another showing of a card due again soon.
    inserted: list[InsertedExercise] = []


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


class StartSpellingSession(_Input):
    """A spelling card for each word learned today (ADR 0016); may be repeated for practice."""

    kind: Literal["spelling"]


StartRequest = StartStudySession | StartHardSession | StartSpellingSession
StartSessionIn = Annotated[StartRequest, Field(discriminator="kind")]


class RatingResponse(_Input):
    kind: Literal["rating"]
    # 1 Снова, 2 Трудно, 3 Хорошо, 4 Легко
    rating: Annotated[int, Field(ge=1, le=4)]


class SpellingResponse(_Input):
    kind: Literal["spelling"]
    # The letters of the tiles chosen, in order; checked and discarded, never stored.
    answer: Annotated[str, StringConstraints(max_length=64)]


class AttemptIn(_Input):
    exercise_id: Annotated[str, StringConstraints(max_length=8)]
    response: Annotated[RatingResponse | SpellingResponse, Field(discriminator="kind")]


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
    # Today's plan once this session is done (ADR 0015); practice sessions are never part of it.
    today: "TodayPlanOut"
    spelling: "SpellingSummaryOut | None" = None


class SpellingSummaryOut(BaseModel):
    """A spelling session (ADR 0016): its words, those built right at the first try, and those
    built after a mistake."""

    words: int
    first_try: int
    needs_practice: int


class WordStages(BaseModel):
    introduced: int
    # Introduced but not yet well learned.
    reviewing: int
    # "Currently well learned": in review with FSRS stability of 21 days or more (ADR 0012).
    well_learned: int
    due: int


class PlanDayOut(BaseModel):
    """One local day (ADR 0015): any answers at all, and whether the day's plan was done."""

    date: date
    active: bool
    plan_done: bool
    new_words: int
    # New words the plan asked for that day (0: no new word was possible; reviews were the plan).
    target: int


class TodayPlanOut(BaseModel):
    new_words: int
    target: int
    plan_done: bool
    # New words beyond today's target: extra, never part of the plan.
    extra_new: int
    # Today's spelling: part of the plan (ADR 0016).
    spelling: "SpellingTodayOut"


class RecallRate(BaseModel):
    """Review cards rated anything but «Снова» over the last `days`: recall after a delay, not
    the first showing of new words."""

    recalled: int
    reviewed: int
    days: int


class ProgressOut(BaseModel):
    """The whole course: where the learner stands on its words and how steadily they practise."""

    words: WordStages
    today: PlanDayOut
    # Weeks in a row with the promise kept (ADR 0015).
    streak_weeks: int
    # Days with answers in the last year, oldest first; the calendar fills the gaps.
    activity: list[PlanDayOut]
    # This week's promise: days with the plan done.
    promised_days: int
    recall: RecallRate
    spelling_today: "SpellingTodayOut"


class SpellingTodayOut(BaseModel):
    """Today's spelling (ADR 0016): the planned new words to spell, and how many a finished
    spelling session has covered (mistakes or not). Extra practice never raises it."""

    words: int
    done: int


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
