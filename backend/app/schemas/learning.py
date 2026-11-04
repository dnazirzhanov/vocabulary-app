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
    """A course level on home (ADR 0020); other decks are in «Мои колоды»."""

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


class DeckStatsOut(BaseModel):
    """A deck's page (ADR 0020): my progress on it and what studying it would bring today."""

    id: str
    title: str
    kind: Literal["course", "user"]
    level: str | None
    # Where a deck I didn't write comes from; whether I wrote it.
    is_mine: bool
    author: str | None
    group_name: str | None
    word_count: int
    introduced_count: int
    learning_count: int
    review_count: int
    # Remembered well: FSRS stability of 21 days or more, as on the progress page.
    well_learned: int
    # «Знаю»: words recalled in a later review, any answer but «Снова» (ADR 0034), as on
    # «Прогресс».
    learned: int = 0
    # New words opening it would bring today, within the daily pace (0 for a locked level).
    new_today: int
    next_due_at: datetime | None
    locked: bool
    # Today's spelling covers words learned today from any deck.
    spelling_today: "SpellingTodayOut"


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
    deck_id: str | None  # null for a finished lesson whose deck was deleted
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
    """Spelling cards (ADR 0016) for one set of words, at most `size` (ADR 0026): `mix` (due hard
    words, then today's and other words never spelled), `today`, `hard` or `random`."""

    kind: Literal["spelling"]
    mode: Literal["mix", "today", "hard", "random"] = "mix"
    size: Literal[5, 10, 20, 30] = 10


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
    deck_id: str | None  # null for a finished lesson whose deck was deleted
    words: list[SummaryWord]
    new_words: int
    reviewed_words: int
    ratings: RatingCounts
    # Where spelling stands once this session is done (ADR 0026): the summary's next step.
    spelling_today: "SpellingTodayOut"
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


class StudyDayOut(BaseModel):
    """One local day (ADR 0027): any answers at all, and whether it counts — a session finished."""

    date: date
    active: bool
    studied: bool
    # Cards answered that day, of any kind (the calendar's shade).
    cards: int = 0


class RecallRate(BaseModel):
    """Review cards rated anything but «Снова» over the last `days`: recall after a delay, not
    the first showing of new words."""

    recalled: int
    reviewed: int
    days: int


class DeckProgressOut(BaseModel):
    """One deck on «Прогресс» (ADR 0022): what I've learned of it."""

    id: str
    title: str
    kind: Literal["course", "user"]
    # Where it comes from: a course level, my own, or a group's (author's nickname, group).
    level: str | None
    is_mine: bool
    author: str | None
    group_name: str | None
    word_count: int
    # Met at least once; learned: recalled in a later review (any answer but «Снова»); known well:
    # FSRS stability of 21 days or more.
    met: int
    learned: int
    known: int
    last_studied_at: datetime | None
    # Today in this deck (ADR 0028): new words met and the day's goal (0: nothing left to meet);
    # a teacher's «Выучить к». Shown, never judged.
    new_today: int = 0
    goal_today: int = 0
    due_on: date | None = None
    # New words a day in it (the course's for its levels), for «≈ N дней до конца» (ADR 0033).
    pace: int = 0


class KnowledgeOut(BaseModel):
    """«Прогресс»: every deck I study, latest studied first, and totals over distinct words (a
    word in two decks counts once)."""

    decks: list[DeckProgressOut]
    met: int
    learned: int
    known: int
    # Words of these decks first recalled since Monday: «+N за эту неделю» (ADR 0034).
    learned_this_week: int = 0


class ProgressOut(BaseModel):
    """The whole course: where the learner stands on its words and how steadily they practise."""

    words: WordStages
    today: StudyDayOut
    # Weeks in a row with every promised day done (ADR 0039).
    streak_weeks: int
    # Days with answers in the last year, oldest first; the calendar fills the gaps.
    activity: list[StudyDayOut]
    # This week's promise: Monday … Sunday, true on the days promised (ADR 0039).
    promised_week: list[bool]
    recall: RecallRate
    spelling_today: "SpellingTodayOut"


class SpellingTodayOut(BaseModel):
    """Where the learner's spelling stands (ADR 0026), for the spelling buttons and «Прогресс»."""

    ready: int  # words the main button gives now (at most 10)
    due: int  # hard and climbing words due again
    today: int  # new words learned today
    today_left: int  # of those, never spelled
    hard: int  # misspelled last time
    known: int  # «умеет писать»
    met: int  # every word met: the pool for «Вразброс»
    # A spelling session left unfinished: resumed where it stopped, never lost.
    paused: "SpellingPausedOut | None" = None


class SpellingPausedOut(BaseModel):
    spelled: int  # cards answered so far
    right: int  # of those, right on the first try
    total: int


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
