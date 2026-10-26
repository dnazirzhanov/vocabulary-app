"""Pure learning rules: which words a session teaches, in what order, and how answers are judged.

No database or HTTP here, so every rule is unit-testable and deterministic.
"""

import random
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from app.services.content import headword_pattern

ExerciseType = Literal["introduce", "choose_meaning", "type_word"]

NEW_WORDS_PER_SESSION = 5
OPTIONS_PER_QUESTION = 4
BLANK = "____"


@dataclass(frozen=True)
class WordFacts:
    """The parts of a word the planner and evaluator need."""

    id: str
    headword: str
    pos: str
    translation: str
    also_accept: tuple[str, ...] = ()


@dataclass(frozen=True)
class PlannedExercise:
    id: str
    type: ExerciseType
    word_id: str
    # choose_meaning only: word ids in display order, including the answer.
    options: tuple[str, ...] = ()

    def to_json(self) -> dict[str, object]:
        data: dict[str, object] = {"id": self.id, "type": self.type, "word_id": self.word_id}
        if self.options:
            data["options"] = list(self.options)
        return data

    @classmethod
    def from_json(cls, data: dict[str, object]) -> "PlannedExercise":
        options = data.get("options", [])
        assert isinstance(options, list)
        return cls(
            id=str(data["id"]),
            type=data["type"],  # type: ignore[arg-type]
            word_id=str(data["word_id"]),
            options=tuple(str(option) for option in options),
        )


def pick_new_words(
    deck_order: Sequence[str], introduced: set[str], limit: int = NEW_WORDS_PER_SESSION
) -> list[str]:
    """The next words in deck order the learner has not been introduced to."""
    return [word_id for word_id in deck_order if word_id not in introduced][:limit]


def pick_options(target: WordFacts, pool: Sequence[WordFacts], rng: random.Random) -> list[str]:
    """Three distractors plus the answer. Same part of speech first, so grammar gives nothing away;
    distractors never share the target's translation, so exactly one option is right."""
    candidates = [w for w in pool if w.id != target.id and w.translation != target.translation]
    same_pos = [w for w in candidates if w.pos == target.pos]
    other_pos = [w for w in candidates if w.pos != target.pos]
    rng.shuffle(same_pos)
    rng.shuffle(other_pos)
    distractors = (same_pos + other_pos)[: OPTIONS_PER_QUESTION - 1]
    options = [w.id for w in distractors]
    options.insert(rng.randrange(len(options) + 1), target.id)
    return options


def _seeded(seed: str) -> random.Random:
    # Not security-sensitive: the seed only makes option order reproducible per session.
    return random.Random(seed)  # noqa: S311


def _number(exercises: list[tuple[ExerciseType, str, tuple[str, ...]]]) -> list[PlannedExercise]:
    return [
        PlannedExercise(id=str(index), type=kind, word_id=word_id, options=options)
        for index, (kind, word_id, options) in enumerate(exercises, start=1)
    ]


def plan_new_session(
    words: Sequence[WordFacts], pool: Sequence[WordFacts], seed: str
) -> list[PlannedExercise]:
    """Introduce each word and check recognition straight away; then, once all words have been
    seen, ask for each word again in production form (typing), which needs real recall."""
    rng = _seeded(seed)
    steps: list[tuple[ExerciseType, str, tuple[str, ...]]] = []
    for word in words:
        steps.append(("introduce", word.id, ()))
        steps.append(("choose_meaning", word.id, tuple(pick_options(word, pool, rng))))
    steps += [("type_word", word.id, ()) for word in words]
    return _number(steps)


def plan_practice_session(
    words: Sequence[WordFacts], pool: Sequence[WordFacts], seed: str
) -> list[PlannedExercise]:
    """Words the learner got wrong: recognition for all, then production for all."""
    rng = _seeded(seed)
    steps: list[tuple[ExerciseType, str, tuple[str, ...]]] = [
        ("choose_meaning", word.id, tuple(pick_options(word, pool, rng))) for word in words
    ]
    steps += [("type_word", word.id, ()) for word in words]
    return _number(steps)


_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "`": "'"})
_EDGE_PUNCTUATION = '.,!?;:"«»()'


def normalize_answer(text: str) -> str:
    """Forgive what is not spelling: case, spacing, apostrophe style, trailing punctuation."""
    text = unicodedata.normalize("NFKC", text).translate(_APOSTROPHES)
    text = re.sub(r"\s+", " ", text).strip().strip(_EDGE_PUNCTUATION).strip()
    return text.lower()


def is_typed_answer_correct(text: str, word: WordFacts) -> bool:
    answer = normalize_answer(text)
    return answer != "" and answer in {
        normalize_answer(form) for form in (word.headword, *word.also_accept)
    }


def cloze(example: str, headword: str) -> str | None:
    """The example with the first occurrence of the headword blanked out, if it occurs."""
    blanked, count = headword_pattern(headword).subn(BLANK, example, count=1)
    return blanked if count else None
