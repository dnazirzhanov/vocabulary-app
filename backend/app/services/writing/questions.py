"""The Writing question bank: plain data, so adding a question never touches application logic.

IELTS Writing Task 2 questions (ADR 0081, 0090): original, in the exam's five task types, on the
20 topics the exam asks about most, five each. English prompts only. Ids are stable (a saved
submission points at one); never reuse or renumber an id. The earlier general questions and their
essays were removed (ADR 0090)."""

# ruff: noqa: E501  (the questions are data: one per line reads better than strings split mid-sentence)

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


TASK2_INSTRUCTION = (
    "Give reasons for your answer and include any relevant examples from your own knowledge or "
    "experience. Write at least 250 words."
)
TASK_TYPES = ("opinion", "discussion", "problem_solution", "advantages", "two_part")


def _t2(id: str, topic: str, task_type: str, title: str) -> WritingQuestion:
    assert task_type in TASK_TYPES, task_type
    return WritingQuestion(id, topic, title, TASK2_INSTRUCTION, None, 40, task_type)


# The 20 topics IELTS Writing Task 2 asks about most (ADR 0090), five questions each, written for
# this app in the exam's style (no exam's own wording). An id never changes: essays keep their
# question. The first forty kept their ids when the eight first topics became these twenty.
_IELTS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "Education",
        [
            (
                "ielts-edu-1",
                "opinion",
                "Some people believe that university education should be free for all students. To what extent do you agree or disagree?",
            ),
            (
                "ielts-edu-2",
                "discussion",
                "Some people think children should start learning a foreign language at primary school, while others believe they should wait until secondary school. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-edu-3",
                "two_part",
                "In many countries, more students now study online than in classrooms. Why is this happening? Is it a positive or negative development?",
            ),
            (
                "ielts-edu-4",
                "advantages",
                "Some students take a year off between finishing school and starting university, to work or to travel. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-edu-5",
                "opinion",
                "Schools should teach practical skills, such as managing money and cooking, instead of academic subjects like history. To what extent do you agree or disagree?",
            ),
        ],
    ),
    (
        "Technology & AI",
        [
            (
                "ielts-tech-1",
                "opinion",
                "Smartphones have done more harm than good to the way people communicate. To what extent do you agree or disagree?",
            ),
            (
                "ielts-tech-2",
                "discussion",
                "Some people think that artificial intelligence will create more jobs than it destroys, while others believe the opposite. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-tech-3",
                "problem_solution",
                "Many children now spend several hours a day in front of screens. What problems does this cause, and what can parents and schools do about it?",
            ),
            (
                "ielts-tech-4",
                "advantages",
                "Many people now work from home using the internet. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-tech-5",
                "two_part",
                "People today share a great deal of personal information online. Why do they do this? What risks does it bring?",
            ),
        ],
    ),
    (
        "Environment & Climate",
        [
            (
                "ielts-env-1",
                "opinion",
                "The best way to reduce pollution is to make fuel and plastic much more expensive. To what extent do you agree or disagree?",
            ),
            (
                "ielts-env-2",
                "discussion",
                "Some people believe that protecting the environment is the responsibility of governments, while others think individuals should take the main responsibility. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-env-3",
                "problem_solution",
                "In many cities, the amount of household waste is growing fast. What are the causes, and what solutions can you suggest?",
            ),
            (
                "ielts-env-4",
                "advantages",
                "Some countries are building more nuclear power stations to reduce the use of coal and gas. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-env-5",
                "two_part",
                "Many wild animals are in danger of disappearing. Why is this happening? What can be done to protect them?",
            ),
        ],
    ),
    (
        "Health",
        [
            (
                "ielts-health-1",
                "opinion",
                "Governments should put a high tax on sugary drinks and fast food to improve public health. To what extent do you agree or disagree?",
            ),
            (
                "ielts-health-2",
                "discussion",
                "Some people think that the main cause of health problems is an unhealthy lifestyle, while others believe it is mostly genetics and the environment. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-health-3",
                "problem_solution",
                "Many young people today experience stress and anxiety. What are the causes, and how can this problem be reduced?",
            ),
            (
                "ielts-health-4",
                "advantages",
                "More people now use apps and smartwatches to track their health. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-health-6",
                "two_part",
                "Many people now look for medical advice online instead of visiting a doctor. Why is this happening? Is it a positive or negative development?",
            ),
        ],
    ),
    (
        "Work & Careers",
        [
            (
                "ielts-work-1",
                "opinion",
                "Job satisfaction is more important than a high salary. To what extent do you agree or disagree?",
            ),
            (
                "ielts-work-2",
                "discussion",
                "Some people think it is better to stay with one company for a long time, while others believe changing jobs often is better. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-work-3",
                "problem_solution",
                "Many young graduates cannot find jobs that match their qualifications. What are the causes, and what can be done?",
            ),
            (
                "ielts-work-4",
                "advantages",
                "A four-day working week is becoming popular in some companies. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-work-5",
                "two_part",
                "More people now choose to work for themselves rather than for an employer. Why is this? Is it a positive or negative trend?",
            ),
        ],
    ),
    (
        "Government & Society",
        [
            (
                "ielts-society-5",
                "opinion",
                "Community service, such as helping in hospitals or cleaning parks, should be compulsory for all teenagers. To what extent do you agree or disagree?",
            ),
            (
                "ielts-gov-1",
                "opinion",
                "Governments should spend more money on public services such as schools and hospitals than on defence. To what extent do you agree or disagree?",
            ),
            (
                "ielts-gov-2",
                "discussion",
                "Some people think the government should provide free healthcare for everyone, while others believe people should pay for their own. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-gov-3",
                "problem_solution",
                "In many countries, the gap between rich and poor is growing. What are the causes of this, and what can be done about it?",
            ),
            (
                "ielts-gov-4",
                "advantages",
                "Some countries make voting in elections compulsory. Do the advantages of this outweigh the disadvantages?",
            ),
        ],
    ),
    (
        "Crime & Punishment",
        [
            (
                "ielts-crime-1",
                "opinion",
                "Prison is the most effective way to reduce crime. To what extent do you agree or disagree?",
            ),
            (
                "ielts-crime-2",
                "discussion",
                "Some people think young offenders should be punished in the same way as adults, while others believe they should be educated and given a second chance. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-crime-3",
                "problem_solution",
                "Online crime, such as fraud and identity theft, is increasing. What are the causes, and what can be done to stop it?",
            ),
            (
                "ielts-crime-4",
                "advantages",
                "Many cities now use surveillance cameras in streets and public places. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-crime-5",
                "two_part",
                "Crime rates are much higher in some parts of a city than in others. Why is this? What can be done to make these areas safer?",
            ),
        ],
    ),
    (
        "Globalisation",
        [
            (
                "ielts-global-1",
                "opinion",
                "Globalisation has done more good than harm to developing countries. To what extent do you agree or disagree?",
            ),
            (
                "ielts-global-2",
                "discussion",
                "Some people think international companies help local economies, while others believe they harm local businesses. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-global-3",
                "two_part",
                "Around the world, people increasingly wear the same clothes, eat the same food and watch the same films. Why is this happening? Is it a positive or negative development?",
            ),
            (
                "ielts-global-4",
                "advantages",
                "Many skilled workers move to other countries for better jobs. Do the advantages of this outweigh the disadvantages for the countries they leave?",
            ),
            (
                "ielts-global-5",
                "problem_solution",
                "Many local traditions and crafts are disappearing as countries become more connected. Why is this, and what can be done to protect them?",
            ),
        ],
    ),
    (
        "Culture & Arts",
        [
            (
                "ielts-culture-1",
                "opinion",
                "Governments should spend money on the arts, such as music and theatre, even when there are other urgent needs. To what extent do you agree or disagree?",
            ),
            (
                "ielts-culture-2",
                "discussion",
                "Some people think museums and galleries should be free to enter, while others believe visitors should pay. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-culture-3",
                "two_part",
                "Fewer young people today are interested in traditional music and dance. Why is this? What can be done to change it?",
            ),
            (
                "ielts-culture-4",
                "advantages",
                "Some cities spend a lot of money on public art, such as statues and wall paintings. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-culture-5",
                "problem_solution",
                "Many cinemas and theatres are closing because people prefer to watch films at home. What problems does this cause, and what can be done?",
            ),
        ],
    ),
    (
        "Media & Advertising",
        [
            (
                "ielts-society-2",
                "discussion",
                "Some people think that famous people should have a private life like everyone else, while others think the public has a right to know about them. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-media-1",
                "opinion",
                "Advertising aimed at children should be banned. To what extent do you agree or disagree?",
            ),
            (
                "ielts-media-2",
                "discussion",
                "Some people think newspapers and television news will soon disappear, while others believe they will always be needed. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-media-3",
                "problem_solution",
                "False news spreads quickly on social media. What problems does this cause, and what can be done about it?",
            ),
            (
                "ielts-media-4",
                "advantages",
                "Many young people now want to become online influencers. Do the advantages of this career outweigh the disadvantages?",
            ),
        ],
    ),
    (
        "Family & Children",
        [
            (
                "ielts-life-4",
                "advantages",
                "More and more people now live alone. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-society-4",
                "advantages",
                "In some countries young adults continue to live with their parents until they marry. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-family-1",
                "opinion",
                "Parents, not schools, should be responsible for teaching children how to behave. To what extent do you agree or disagree?",
            ),
            (
                "ielts-family-2",
                "discussion",
                "Some people think both parents should share childcare equally, while others believe one parent should stay at home. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-family-3",
                "problem_solution",
                "Many families today spend very little time together. What are the causes, and how can this be changed?",
            ),
        ],
    ),
    (
        "Cities & Housing",
        [
            (
                "ielts-life-2",
                "discussion",
                "Some people think it is better to live in a big city, while others prefer life in a small town. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-society-3",
                "problem_solution",
                "In many cities people do not know their neighbours. Why is this, and what can be done to build stronger communities?",
            ),
            (
                "ielts-city-1",
                "problem_solution",
                "House prices in many large cities have risen so fast that young people cannot afford a home. What are the causes, and what can be done?",
            ),
            (
                "ielts-city-2",
                "advantages",
                "More people now live in tall apartment buildings than in houses. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-city-3",
                "opinion",
                "City parks and green spaces are more important than new buildings. To what extent do you agree or disagree?",
            ),
        ],
    ),
    (
        "Transport",
        [
            (
                "ielts-transport-1",
                "opinion",
                "Public transport should be free for everyone. To what extent do you agree or disagree?",
            ),
            (
                "ielts-transport-2",
                "discussion",
                "Some people think cities should build more roads, while others believe they should invest in public transport instead. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-transport-3",
                "problem_solution",
                "Traffic jams are a serious problem in many cities. What are the causes, and what solutions can you suggest?",
            ),
            (
                "ielts-transport-4",
                "advantages",
                "Some cities have banned private cars from their centres. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-transport-5",
                "two_part",
                "Electric cars are becoming more common. Why is this happening? Will they solve the problems caused by cars?",
            ),
        ],
    ),
    (
        "Travel & Tourism",
        [
            (
                "ielts-travel-1",
                "opinion",
                "International tourism does more harm than good to local communities. To what extent do you agree or disagree?",
            ),
            (
                "ielts-travel-2",
                "discussion",
                "Some people prefer to travel on organised tours, while others prefer to plan their trips themselves. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-travel-3",
                "problem_solution",
                "Many popular tourist cities are now overcrowded. What problems does this cause, and what can be done about it?",
            ),
            (
                "ielts-travel-4",
                "advantages",
                "More young people now travel abroad alone before they start work. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-travel-5",
                "two_part",
                "Cheap flights have made air travel possible for many more people. Why has flying become so popular? Is this a positive or negative development?",
            ),
        ],
    ),
    (
        "Sport & Leisure",
        [
            (
                "ielts-life-3",
                "problem_solution",
                "Many people today feel they have too little free time. What are the causes of this, and what can be done to solve the problem?",
            ),
            (
                "ielts-sport-1",
                "opinion",
                "Professional athletes are paid far too much money. To what extent do you agree or disagree?",
            ),
            (
                "ielts-sport-2",
                "discussion",
                "Some people think children should be made to play team sports at school, while others believe they should choose their own activities. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-sport-3",
                "two_part",
                "Fewer people today read books for pleasure. Why is this? What can be done to encourage reading?",
            ),
            (
                "ielts-sport-4",
                "advantages",
                "Hosting a major international sports event, such as the Olympic Games, costs a great deal of money. Do the advantages of this outweigh the disadvantages?",
            ),
        ],
    ),
    (
        "Science & Space",
        [
            (
                "ielts-science-1",
                "opinion",
                "Money spent on space exploration would be better spent on solving problems on Earth. To what extent do you agree or disagree?",
            ),
            (
                "ielts-science-2",
                "discussion",
                "Some people think scientific research should be paid for by governments, while others believe private companies should pay for it. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-science-3",
                "two_part",
                "Many young people do not choose to study science at university. Why is this? What can be done to change it?",
            ),
            (
                "ielts-science-4",
                "advantages",
                "Scientists can now change the genes of plants and animals. Do the advantages of this outweigh the disadvantages?",
            ),
            (
                "ielts-science-5",
                "problem_solution",
                "Many people today do not trust scientists and experts. Why is this, and how can this trust be rebuilt?",
            ),
        ],
    ),
    (
        "Language",
        [
            (
                "ielts-language-1",
                "opinion",
                "Everyone should learn English because it is the most important language in the world. To what extent do you agree or disagree?",
            ),
            (
                "ielts-language-2",
                "discussion",
                "Some people think a language is best learned in the country where it is spoken, while others believe it can be learned just as well at home. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-language-3",
                "two_part",
                "Many minority languages are disappearing. Why is this happening? Does it matter?",
            ),
            (
                "ielts-language-4",
                "advantages",
                "Translation apps can now translate speech instantly. Do the advantages of these apps outweigh the disadvantages for people learning languages?",
            ),
            (
                "ielts-language-5",
                "problem_solution",
                "Many adults find it very difficult to learn a new language. Why is this, and what can help them?",
            ),
        ],
    ),
    (
        "Food & Diet",
        [
            (
                "ielts-life-1",
                "opinion",
                "Some people believe that cooking at home is a waste of time when ready-made food is cheap and easy to buy. To what extent do you agree or disagree?",
            ),
            (
                "ielts-food-1",
                "opinion",
                "Fast food restaurants should not be allowed near schools. To what extent do you agree or disagree?",
            ),
            (
                "ielts-food-2",
                "discussion",
                "Some people think a vegetarian diet is the best way to stay healthy and protect the planet, while others believe eating meat is necessary. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-food-3",
                "problem_solution",
                "In many countries, people throw away large amounts of food. Why does this happen, and what can be done to reduce it?",
            ),
            (
                "ielts-food-4",
                "advantages",
                "More and more meals are now delivered to people's homes through apps. Do the advantages of this outweigh the disadvantages?",
            ),
        ],
    ),
    (
        "Money & Consumerism",
        [
            (
                "ielts-life-5",
                "two_part",
                "Many people spend a lot of money on celebrations such as weddings and birthdays. Why do people do this? Is it a positive or negative development?",
            ),
            (
                "ielts-money-1",
                "opinion",
                "People today buy too many things they do not really need. To what extent do you agree or disagree?",
            ),
            (
                "ielts-money-2",
                "discussion",
                "Some people think it is better to save money for the future, while others believe it is more important to enjoy it now. Discuss both views and give your own opinion.",
            ),
            (
                "ielts-money-3",
                "two_part",
                "In many countries, people now pay for almost everything by card or phone and rarely use cash. Why is this? Is it a positive or negative development?",
            ),
            (
                "ielts-money-4",
                "advantages",
                "Buying second-hand clothes and goods is becoming more popular. Do the advantages of this outweigh the disadvantages?",
            ),
        ],
    ),
    (
        "Population & Ageing",
        [
            (
                "ielts-health-5",
                "two_part",
                "In many countries people are living longer than before. What problems does this create? How can society deal with them?",
            ),
            (
                "ielts-society-1",
                "opinion",
                "Older people have more to teach young people than the internet does. To what extent do you agree or disagree?",
            ),
            (
                "ielts-ageing-1",
                "opinion",
                "There should be no fixed age at which people have to stop working. To what extent do you agree or disagree?",
            ),
            (
                "ielts-ageing-2",
                "problem_solution",
                "In many countries, fewer babies are being born each year. What problems does this cause, and what solutions can you suggest?",
            ),
            (
                "ielts-ageing-3",
                "discussion",
                "Some people think elderly people should live with their families, while others believe care homes are better for them. Discuss both views and give your own opinion.",
            ),
        ],
    ),
]

QUESTIONS: tuple[WritingQuestion, ...] = tuple(
    _t2(question_id, topic, task_type, title)
    for topic, items in _IELTS
    for question_id, task_type, title in items
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
