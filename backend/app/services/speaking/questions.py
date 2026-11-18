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
    topic: str = "General"
    level: str | None = None
    reference_text: str | None = None  # Only set for pronunciation


QUESTIONS: list[Question] = [
    # Daily Life
    Question(
        id="spon-daily-routine",
        exercise_type="spontaneous",
        text="Describe your typical morning routine.",
        topic="Daily Life",
        level="A2",
    ),
    Question(
        id="spon-hometown",
        exercise_type="spontaneous",
        text="Describe your home city to someone who has never been there.",
        topic="Daily Life",
        level="A2",
    ),
    Question(
        id="spon-food",
        exercise_type="spontaneous",
        text="What is your favourite meal and how is it prepared?",
        topic="Daily Life",
        level="A2",
    ),
    # Entertainment
    Question(
        id="spon-films",
        exercise_type="spontaneous",
        text="Tell me about your favourite film and why you enjoy it.",
        topic="Entertainment",
        level="B1",
    ),
    Question(
        id="spon-books",
        exercise_type="spontaneous",
        text="Do you prefer reading books or watching films? Why?",
        topic="Entertainment",
        level="B1",
    ),
    Question(
        id="spon-music",
        exercise_type="spontaneous",
        text="What kind of music do you enjoy, and does it affect your mood?",
        topic="Entertainment",
        level="B1",
    ),
    # Education & Work
    Question(
        id="spon-online-learning",
        exercise_type="spontaneous",
        text="What are the advantages and disadvantages of online learning?",
        topic="Education & Work",
        level="B2",
    ),
    Question(
        id="spon-ideal-job",
        exercise_type="spontaneous",
        text="Describe your ideal job and explain why it appeals to you.",
        topic="Education & Work",
        level="B1",
    ),
    Question(
        id="spon-skills",
        exercise_type="spontaneous",
        text="What skills do you think are most important in today's workplace?",
        topic="Education & Work",
        level="B2",
    ),
    # Travel
    Question(
        id="spon-travel-dream",
        exercise_type="spontaneous",
        text="Where would you most like to travel and why?",
        topic="Travel",
        level="A2",
    ),
    Question(
        id="spon-travel-experience",
        exercise_type="spontaneous",
        text="Tell me about an interesting trip you have taken.",
        topic="Travel",
        level="B1",
    ),
    Question(
        id="spon-travel-culture",
        exercise_type="spontaneous",
        text="How does travelling to a new country change your perspective?",
        topic="Travel",
        level="B2",
    ),
    # Technology
    Question(
        id="spon-tech-daily",
        exercise_type="spontaneous",
        text="How has technology changed the way you communicate with others?",
        topic="Technology",
        level="B1",
    ),
    Question(
        id="spon-social-media",
        exercise_type="spontaneous",
        text="What are the pros and cons of social media for young people?",
        topic="Technology",
        level="B2",
    ),
    # Pronunciation practice
    Question(
        id="pron-weather",
        exercise_type="pronunciation",
        text="Read the sentence out loud.",
        topic="Pronunciation",
        level="A2",
        reference_text="The weather in November is cold and rainy.",
    ),
    Question(
        id="pron-restaurant",
        exercise_type="pronunciation",
        text="Read the sentence out loud.",
        topic="Pronunciation",
        level="B1",
        reference_text="I would like to book a table for two at seven o'clock.",
    ),
    Question(
        id="pron-directions",
        exercise_type="pronunciation",
        text="Read the sentence out loud.",
        topic="Pronunciation",
        level="A2",
        reference_text="Go straight on and turn left at the traffic lights.",
    ),
    Question(
        id="pron-opinion",
        exercise_type="pronunciation",
        text="Read the sentence out loud.",
        topic="Pronunciation",
        level="B1",
        reference_text="In my opinion, learning a foreign language opens many doors.",
    ),
]


def by_id(question_id: str) -> Question | None:
    return next((q for q in QUESTIONS if q.id == question_id), None)


def list_all(exercise_type: str | None = None) -> list[Question]:
    if exercise_type is None:
        return list(QUESTIONS)
    return [q for q in QUESTIONS if q.exercise_type == exercise_type]
