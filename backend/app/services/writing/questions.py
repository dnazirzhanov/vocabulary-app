"""The Writing question bank: plain data, so adding a question never touches application logic.

English prompts only: Writing trains English, like the rest of the course. Ids are stable (a saved
submission points at one); never reuse or renumber an id."""

from dataclasses import dataclass


@dataclass(frozen=True)
class WritingQuestion:
    id: str
    topic: str
    title: str
    instruction: str
    level: str | None = None  # CEFR, a rough guide only
    suggested_minutes: int | None = None


def _q(
    id: str, topic: str, title: str, instruction: str, level: str, minutes: int
) -> WritingQuestion:
    return WritingQuestion(id, topic, title, instruction, level, minutes)


QUESTIONS: tuple[WritingQuestion, ...] = (
    # Everyday Life
    _q(
        "life-morning",
        "Everyday Life",
        "Describe a typical day in your life.",
        "Write about what you usually do from morning to evening.",
        "A2",
        10,
    ),
    _q(
        "life-home",
        "Everyday Life",
        "Describe the place where you live.",
        "Say what it looks like and what you like or dislike about it.",
        "A2",
        10,
    ),
    _q(
        "life-weekend",
        "Everyday Life",
        "How do you like to spend your weekends?",
        "Give some details and say why you enjoy these activities.",
        "B1",
        12,
    ),
    # Education
    _q(
        "edu-subject",
        "Education",
        "What is your favourite subject, and why?",
        "Give at least two reasons and an example.",
        "A2",
        10,
    ),
    _q(
        "edu-online",
        "Education",
        "Is studying online as good as studying in a classroom?",
        "Give your opinion and support it with examples.",
        "B1",
        15,
    ),
    _q(
        "edu-uniform",
        "Education",
        "Should students wear school uniforms?",
        "Explain your opinion. Think about both sides before you decide.",
        "B1",
        15,
    ),
    # Technology
    _q(
        "tech-social",
        "Technology",
        "Do you think social media has a positive or negative effect on young people?",
        "Explain your opinion and support it with examples.",
        "B2",
        20,
    ),
    _q(
        "tech-phone",
        "Technology",
        "How often do you use your phone, and what for?",
        "Describe your habits. Would you like to change them?",
        "A2",
        10,
    ),
    _q(
        "tech-ai",
        "Technology",
        "How will artificial intelligence change our daily lives?",
        "Write about the changes you expect, good and bad.",
        "B2",
        20,
    ),
    # Environment
    _q(
        "env-helping",
        "Environment",
        "What can ordinary people do to protect the environment?",
        "Suggest some actions and explain why they help.",
        "B1",
        15,
    ),
    _q(
        "env-city",
        "Environment",
        "Is your city clean? Describe its main environmental problem.",
        "Say what the problem is and how it could be solved.",
        "B1",
        15,
    ),
    _q(
        "env-weather",
        "Environment",
        "Describe the weather and seasons where you live.",
        "Say which season you like best and why.",
        "A2",
        10,
    ),
    # Health
    _q(
        "health-habits",
        "Health",
        "What do you do to stay healthy?",
        "Write about food, sport, sleep or anything else you do.",
        "A2",
        10,
    ),
    _q(
        "health-sleep",
        "Health",
        "Why is sleep important, and how can people sleep better?",
        "Give reasons and practical advice.",
        "B1",
        15,
    ),
    _q(
        "health-stress",
        "Health",
        "Many people feel stressed today. What are the main causes?",
        "Explain the causes and suggest what people can do about it.",
        "B2",
        20,
    ),
    # Travel
    _q(
        "travel-trip",
        "Travel",
        "Describe a trip you remember well.",
        "Say where you went, who with, and why you remember it.",
        "B1",
        15,
    ),
    _q(
        "travel-dream",
        "Travel",
        "Which country would you most like to visit?",
        "Explain why and what you would do there.",
        "A2",
        10,
    ),
    _q(
        "travel-tourism",
        "Travel",
        "Is tourism good or bad for a country?",
        "Discuss the advantages and disadvantages, then give your view.",
        "B2",
        20,
    ),
    # Society
    _q(
        "soc-neighbours",
        "Society",
        "Do you know your neighbours? Is it important to?",
        "Give your opinion with examples from your own life.",
        "B1",
        12,
    ),
    _q(
        "soc-volunteer",
        "Society",
        "Should young people do volunteer work?",
        "Explain your opinion and give examples.",
        "B1",
        15,
    ),
    _q(
        "soc-city-village",
        "Society",
        "Is it better to live in a big city or in a small town?",
        "Compare them and say which you prefer.",
        "B2",
        20,
    ),
    # Work and Careers
    _q(
        "work-dream-job",
        "Work and Careers",
        "What is your dream job, and why?",
        "Describe the job and the skills you would need.",
        "A2",
        10,
    ),
    _q(
        "work-home",
        "Work and Careers",
        "Is working from home better than working in an office?",
        "Discuss both and give your opinion.",
        "B2",
        20,
    ),
    _q(
        "work-email",
        "Work and Careers",
        "Write an email asking your manager for a day off.",
        "Be polite, give a reason, and suggest how your work will be covered.",
        "B1",
        12,
    ),
)

_BY_ID = {q.id: q for q in QUESTIONS}
assert len(_BY_ID) == len(QUESTIONS), "duplicate writing question id"


def get(question_id: str) -> WritingQuestion | None:
    return _BY_ID.get(question_id)


def list_all(topic: str | None = None) -> list[WritingQuestion]:
    return [q for q in QUESTIONS if topic is None or q.topic == topic]


def topics() -> list[tuple[str, int]]:
    """Topic names in the bank's order, each with its number of questions."""
    counts: dict[str, int] = {}
    for q in QUESTIONS:
        counts[q.topic] = counts.get(q.topic, 0) + 1
    return list(counts.items())
