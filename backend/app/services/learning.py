"""Pure learning rules: which exercises a study session shows, and in what order.

A session is a queue of flashcards, like a day in Anki (ADR 0012): due reviews first, most overdue
first, then new words in deck order. A card rated «Снова» or «Трудно» while still being learned
comes back later in the same session as another showing. After the cards comes spelling (ADR 0016):
guided practice of today's new words, then recall of them and of spelling reviews due. No
database or HTTP here.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

ExerciseType = Literal["card", "spell_guided", "spell_recall"]
SPELLING_TYPES = ("spell_guided", "spell_recall")

REVIEW_CARDS_PER_SESSION = 30  # a session of a few minutes; another can follow straight away
NEW_CARDS_PER_SESSION = 5  # the default size of a new lesson (the daily pace overrides it)
HARD_CARDS_PER_SESSION = 10
# A card due again within this window comes back in the same session (Anki's learning steps).
REQUEUE_WITHIN_SECONDS = 20 * 60
MAX_SHOWINGS_PER_SESSION = 4  # after that, it waits for the next session
# A requeued card returns after this many other cards (or at the end of the queue).
REQUEUE_GAP = 3


@dataclass(frozen=True)
class PlannedExercise:
    id: str
    type: ExerciseType
    word_id: str
    # True for a word's first showing ever: it is introduced, not recalled.
    new: bool = False
    # Spelling: the letter bank in display order, fixed when planned so it survives a restart.
    tiles: tuple[str, ...] = ()
    # Spelling recall: the one retry after a miss (a second miss ends it as "needs practice").
    retry: bool = False

    @property
    def spelling(self) -> bool:
        return self.type in SPELLING_TYPES

    def to_json(self) -> dict[str, object]:
        data: dict[str, object] = {
            "id": self.id,
            "type": self.type,
            "word_id": self.word_id,
            "new": self.new,
        }
        if self.spelling:
            data |= {"tiles": list(self.tiles), "retry": self.retry}
        return data

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "PlannedExercise":
        kind = str(data.get("type", "card"))
        return cls(
            id=str(data["id"]),
            type=kind if kind in SPELLING_TYPES else "card",  # type: ignore[arg-type]
            word_id=str(data["word_id"]),
            new=bool(data.get("new", False)),
            tiles=tuple(data.get("tiles", ())),
            retry=bool(data.get("retry", False)),
        )


def pick_new_words(deck_order: Sequence[str], introduced: set[str], limit: int) -> list[str]:
    """The next words of the deck the learner has not met, in deck order."""
    return [word_id for word_id in deck_order if word_id not in introduced][:limit]


def plan_cards(due: Sequence[str], new: Sequence[str]) -> list[PlannedExercise]:
    cards = [PlannedExercise(f"c{n}", "card", word_id) for n, word_id in enumerate(due, start=1)]
    cards += [
        PlannedExercise(f"c{len(cards) + n}", "card", word_id, new=True)
        for n, word_id in enumerate(new, start=1)
    ]
    return cards


def plan_spelling(
    new: Sequence[str],
    reviews: Sequence[str],
    first_id: int,
    bank: Callable[[str, str], Sequence[str]],
) -> list[PlannedExercise]:
    """The spelling section: guided practice of today's new words, then recall of the spelling
    reviews due, then recall of the new words — so each new word's recall comes a few exercises
    after its guided practice. `bank(word_id, step_id)` makes a step's letter tiles."""
    order = [("spell_guided", w) for w in new]
    order += [("spell_recall", w) for w in reviews]
    order += [("spell_recall", w) for w in new]
    steps: list[PlannedExercise] = []
    for n, (kind, word_id) in enumerate(order, start=first_id):
        step_id = f"s{n}"
        steps.append(
            PlannedExercise(step_id, kind, word_id, tiles=tuple(bank(word_id, step_id)))  # type: ignore[arg-type]
        )
    return steps


def after_miss(
    plan: Sequence[PlannedExercise],
    answered: int,
    step: PlannedExercise,
    bank: Callable[[str, str], Sequence[str]],
    gap: int,
) -> tuple[list[PlannedExercise], list[tuple[int, PlannedExercise]]]:
    """A recall missed (or the word shown): guided practice of it right away, and — unless this
    was already the retry — one more recall a few exercises later. Never more, so a lesson
    always ends."""
    next_id = len(plan) + 1
    guided = PlannedExercise(
        f"s{next_id}", "spell_guided", step.word_id, tiles=tuple(bank(step.word_id, f"s{next_id}"))
    )
    new_plan = [*plan[: answered + 1], guided, *plan[answered + 1 :]]
    inserted = [(answered + 1, guided)]
    if not step.retry:
        retry_id = f"s{next_id + 1}"
        again = PlannedExercise(
            retry_id,
            "spell_recall",
            step.word_id,
            tiles=tuple(bank(step.word_id, retry_id)),
            retry=True,
        )
        position = min(len(new_plan), answered + 2 + gap)
        new_plan.insert(position, again)
        inserted.append((position, again))
    return new_plan, inserted


def requeue(
    plan: Sequence[PlannedExercise], answered: int, word_id: str
) -> tuple[list[PlannedExercise], PlannedExercise] | None:
    """Insert another showing of `word_id` a few cards after the one just answered (index
    `answered`), unless the card has already been shown enough times this session."""
    if (
        sum(1 for step in plan if step.word_id == word_id and not step.spelling)
        >= MAX_SHOWINGS_PER_SESSION
    ):
        return None
    # Ids stay unique across cards and spelling steps.
    again = PlannedExercise(f"c{len(plan) + 1}", "card", word_id)
    position = min(len(plan), answered + 1 + REQUEUE_GAP)
    return [*plan[:position], again, *plan[position:]], again
