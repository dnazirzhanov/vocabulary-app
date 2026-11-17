"""Static question bank for Chunk 2.

Later chunks replace this with a database-backed, level-matched selection; for now it's a
small hand-curated set so the UI has something to render. English prompts only — the Speaking
feature trains English, like the rest of the course."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Question:
    id: str
    exercise_type: str  # 'spontaneous' | 'pronunciation'
    text: str
    level: str | None = None
    reference_text: str | None = None  # Only set for pronunciation


QUESTIONS: list[Question] = [
    Question(
        id="spon-films",
        exercise_type="spontaneous",
        text="Tell me about your favourite film and why you enjoy it.",
        level="B1",
    ),
    Question(
        id="spon-city",
        exercise_type="spontaneous",
        text="Describe your home city to someone who has never been there.",
        level="A2",
    ),
    Question(
        id="spon-online-learning",
        exercise_type="spontaneous",
        text="What are the advantages and disadvantages of online learning?",
        level="B2",
    ),
    Question(
        id="pron-weather",
        exercise_type="pronunciation",
        text="Read the sentence out loud.",
        level="A2",
        reference_text="The weather in November is cold and rainy.",
    ),
    Question(
        id="pron-restaurant",
        exercise_type="pronunciation",
        text="Read the sentence out loud.",
        level="B1",
        reference_text="I would like to book a table for two at seven o'clock.",
    ),
]


def by_id(question_id: str) -> Question | None:
    return next((q for q in QUESTIONS if q.id == question_id), None)


def list_all(exercise_type: str | None = None) -> list[Question]:
    if exercise_type is None:
        return list(QUESTIONS)
    return [q for q in QUESTIONS if q.exercise_type == exercise_type]
