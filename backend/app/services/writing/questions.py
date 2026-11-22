"""The Writing question bank: plain data, so adding a question never touches application logic.

IELTS Writing Task 2 questions (ADR 0081): original, in the exam's five task types, on the tab's
eight topics. English prompts only. Ids are stable (a saved submission points at one); never reuse
or renumber an id. The earlier general questions are kept in RETIRED so old answers keep their
titles, but are no longer offered."""

from dataclasses import dataclass


@dataclass(frozen=True)
class WritingQuestion:
    id: str
    topic: str
    title: str
    instruction: str
    level: str | None = None  # CEFR, a rough guide only
    suggested_minutes: int | None = None
    # IELTS Task 2 type: opinion, discussion, problem_solution, advantages, two_part (ADR 0081).
    task_type: str | None = None


def _q(
    id: str, topic: str, title: str, instruction: str, level: str, minutes: int
) -> WritingQuestion:
    return WritingQuestion(id, topic, title, instruction, level, minutes)


RETIRED: tuple[WritingQuestion, ...] = (
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

TASK2_INSTRUCTION = (
    "Give reasons for your answer and include any relevant examples from your own knowledge or "
    "experience. Write at least 250 words."
)
TASK_TYPES = ("opinion", "discussion", "problem_solution", "advantages", "two_part")


def _t2(id: str, topic: str, task_type: str, title: str) -> WritingQuestion:
    assert task_type in TASK_TYPES, task_type
    return WritingQuestion(id, topic, title, TASK2_INSTRUCTION, None, 40, task_type)


_IELTS: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "life": (
        "Everyday Life",
        [
            (
                "opinion",
                "Some people believe that cooking at home is a waste of time when ready-made "
                "food is cheap and easy to buy. To what extent do you agree or disagree?",
            ),
            (
                "discussion",
                "Some people think it is better to live in a big city, while others "
                "prefer life in a small town. Discuss both views and give your own opinion.",
            ),
            (
                "problem_solution",
                "Many people today feel they have too little free time. What are "
                "the causes of this, and what can be done to solve the problem?",
            ),
            (
                "advantages",
                "More and more people now live alone. Do the advantages of this outweigh "
                "the disadvantages?",
            ),
            (
                "two_part",
                "Many people spend a lot of money on celebrations such as weddings and "
                "birthdays. Why do people do this? Is it a positive or negative development?",
            ),
        ],
    ),
    "edu": (
        "Education",
        [
            (
                "opinion",
                "Some people believe that university education should be free for all "
                "students. To what extent do you agree or disagree?",
            ),
            (
                "discussion",
                "Some people think children should start learning a foreign language at "
                "primary school, while others believe they should wait until secondary school. "
                "Discuss "
                "both views and give your own opinion.",
            ),
            (
                "two_part",
                "In many countries, more students now study online than in classrooms. Why "
                "is this happening? Is it a positive or negative development?",
            ),
            (
                "advantages",
                "Some students take a year off between finishing school and starting "
                "university, to work or to travel. Do the advantages of this outweigh the "
                "disadvantages?",
            ),
            (
                "opinion",
                "Schools should teach practical skills, such as managing money and cooking, "
                "instead of academic subjects like history. To what extent do you agree or "
                "disagree?",
            ),
        ],
    ),
    "tech": (
        "Technology",
        [
            (
                "opinion",
                "Smartphones have done more harm than good to the way people communicate. "
                "To what extent do you agree or disagree?",
            ),
            (
                "discussion",
                "Some people think that artificial intelligence will create more jobs "
                "than it destroys, while others believe the opposite. Discuss both views and "
                "give your "
                "own opinion.",
            ),
            (
                "problem_solution",
                "Many children now spend several hours a day in front of screens. "
                "What problems does this cause, and what can parents and schools do about it?",
            ),
            (
                "advantages",
                "Many people now work from home using the internet. Do the advantages of "
                "this outweigh the disadvantages?",
            ),
            (
                "two_part",
                "People today share a great deal of personal information online. Why do "
                "they do this? What risks does it bring?",
            ),
        ],
    ),
    "env": (
        "Environment",
        [
            (
                "opinion",
                "The best way to reduce pollution is to make fuel and plastic much more "
                "expensive. To what extent do you agree or disagree?",
            ),
            (
                "discussion",
                "Some people believe that protecting the environment is the "
                "responsibility of governments, while others think individuals should take the "
                "main "
                "responsibility. Discuss both views and give your own opinion.",
            ),
            (
                "problem_solution",
                "In many cities, the amount of household waste is growing fast. "
                "What are the causes, and what solutions can you suggest?",
            ),
            (
                "advantages",
                "Some countries are building more nuclear power stations to reduce the "
                "use of coal and gas. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "two_part",
                "Many wild animals are in danger of disappearing. Why is this happening? "
                "What can be done to protect them?",
            ),
        ],
    ),
    "health": (
        "Health",
        [
            (
                "opinion",
                "Governments should put a high tax on sugary drinks and fast food to improve "
                "public health. To what extent do you agree or disagree?",
            ),
            (
                "discussion",
                "Some people think that the main cause of health problems is an "
                "unhealthy lifestyle, while others believe it is mostly genetics and the "
                "environment. "
                "Discuss both views and give your own opinion.",
            ),
            (
                "problem_solution",
                "Many young people today experience stress and anxiety. What are "
                "the causes, and how can this problem be reduced?",
            ),
            (
                "advantages",
                "More people now use apps and smartwatches to track their health. Do the "
                "advantages of this outweigh the disadvantages?",
            ),
            (
                "two_part",
                "In many countries people are living longer than before. What problems "
                "does this create? How can society deal with them?",
            ),
        ],
    ),
    "travel": (
        "Travel",
        [
            (
                "opinion",
                "International tourism does more harm than good to local communities. To "
                "what extent do you agree or disagree?",
            ),
            (
                "discussion",
                "Some people prefer to travel on organised tours, while others prefer to "
                "plan their trips themselves. Discuss both views and give your own opinion.",
            ),
            (
                "problem_solution",
                "Many popular tourist cities are now overcrowded. What problems "
                "does this cause, and what can be done about it?",
            ),
            (
                "advantages",
                "More young people now travel abroad alone before they start work. Do "
                "the advantages of this outweigh the disadvantages?",
            ),
            (
                "two_part",
                "Cheap flights have made air travel possible for many more people. Why has "
                "flying become so popular? Is this a positive or negative development?",
            ),
        ],
    ),
    "society": (
        "Society",
        [
            (
                "opinion",
                "Older people have more to teach young people than the internet does. To "
                "what extent do you agree or disagree?",
            ),
            (
                "discussion",
                "Some people think that famous people should have a private life like "
                "everyone else, while others think the public has a right to know about them. "
                "Discuss "
                "both views and give your own opinion.",
            ),
            (
                "problem_solution",
                "In many cities people do not know their neighbours. Why is this, "
                "and what can be done to build stronger communities?",
            ),
            (
                "advantages",
                "In some countries young adults continue to live with their parents "
                "until they marry. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "opinion",
                "Community service, such as helping in hospitals or cleaning parks, should "
                "be compulsory for all teenagers. To what extent do you agree or disagree?",
            ),
        ],
    ),
    "work": (
        "Work and Careers",
        [
            (
                "opinion",
                "Job satisfaction is more important than a high salary. To what extent do "
                "you agree or disagree?",
            ),
            (
                "discussion",
                "Some people think it is better to stay with one company for a long "
                "time, while others believe changing jobs often is better. Discuss both views "
                "and give "
                "your own opinion.",
            ),
            (
                "problem_solution",
                "Many young graduates cannot find jobs that match their "
                "qualifications. What are the causes, and what can be done?",
            ),
            (
                "advantages",
                "A four-day working week is becoming popular in some companies. Do the "
                "advantages of this outweigh the disadvantages?",
            ),
            (
                "two_part",
                "More people now choose to work for themselves rather than for an "
                "employer. Why is this? Is it a positive or negative trend?",
            ),
        ],
    ),
}

QUESTIONS: tuple[WritingQuestion, ...] = tuple(
    _t2(f"ielts-{key}-{n}", topic, task_type, title)
    for key, (topic, items) in _IELTS.items()
    for n, (task_type, title) in enumerate(items, start=1)
)

_BY_ID = {q.id: q for q in (*QUESTIONS, *RETIRED)}
assert len(_BY_ID) == len(QUESTIONS) + len(RETIRED), "duplicate writing question id"


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
