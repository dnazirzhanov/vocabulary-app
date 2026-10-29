"""Pure learning rules: which cards a study session shows, and in what order (ADR 0012).

A session is a queue of flashcards, like a day in Anki: due reviews first, most overdue first,
then new words in deck order. A card rated «Снова» or «Трудно» while still being learned comes
back later in the same session as another showing. No database or HTTP here.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

ExerciseType = Literal["card"]

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

    def to_json(self) -> dict[str, object]:
        return {"id": self.id, "type": self.type, "word_id": self.word_id, "new": self.new}

    @classmethod
    def from_json(cls, data: dict[str, object]) -> "PlannedExercise":
        return cls(
            id=str(data["id"]),
            type="card",
            word_id=str(data["word_id"]),
            new=bool(data.get("new", False)),
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


def requeue(
    plan: Sequence[PlannedExercise], answered: int, word_id: str
) -> tuple[list[PlannedExercise], PlannedExercise] | None:
    """Insert another showing of `word_id` a few cards after the one just answered (index
    `answered`), unless the card has already been shown enough times this session."""
    if sum(1 for step in plan if step.word_id == word_id) >= MAX_SHOWINGS_PER_SESSION:
        return None
    again = PlannedExercise(f"c{len(plan) + 1}", "card", word_id)
    position = min(len(plan), answered + 1 + REQUEUE_GAP)
    return [*plan[:position], again, *plan[position:]], again
