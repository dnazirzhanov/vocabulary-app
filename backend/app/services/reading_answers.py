"""Answers to the questions after a text (Reading Mode, round 2): each reader's latest answer to
each open question, within its word limits and never over 500 words, theirs to read again any time;
and their one answer to each question with options, right or wrong, which stays as given.

A question is a library article's (`library:<article>:<n>`, from content/reading/) or one drafted
for a text of the reader's own (`question:<id>`). Answers come through the sync outbox, so one
written offline arrives later; an older edit arriving after a newer one is kept out.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Reading, ReadingAnswer, ReadingQuestion, User
from app.schemas.readings import AnswerOut
from app.services import reading_assignments
from app.services.content import TOKEN
from app.services.reading import MAX_ANSWER_WORDS, library_questions


def count_words(text: str) -> int:
    """Words as the reader counts them (`lib/tokens.ts`): runs of letters, apostrophes inside."""
    return len(TOKEN.findall(text))


@dataclass(frozen=True)
class Asked:
    reading_ref: str
    text: str
    kind: str = "open"
    min_words: int = 1
    max_words: int = MAX_ANSWER_WORDS
    options: tuple[str, ...] = ()
    right: int = -1


def question(db: Session, user: User, question_ref: str) -> Asked:
    """The question an answer is for, if this reader may answer it; else 404."""
    if question_ref.startswith("library:"):
        found = library_questions().get(question_ref)
        if found is not None:
            article_ref, one = found
            if one.kind == "choice":
                return Asked(
                    article_ref, one.q, "choice", options=tuple(one.options or ()), right=one.right
                )
            return Asked(article_ref, one.q, min_words=one.min or 1, max_words=one.max or 1)
    elif question_ref.startswith("question:"):
        try:
            question_id = uuid.UUID(question_ref.removeprefix("question:"))
        except ValueError:
            question_id = None
        asked = db.get(ReadingQuestion, question_id) if question_id else None
        reading_ref: str | None = None
        if asked is not None and asked.assignment_id is not None:
            # A question of a reading given to one of my groups.
            if reading_assignments.may_answer(db, user, asked.assignment_id):
                reading_ref = f"assignment:{asked.assignment_id}"
        elif asked is not None and asked.reading_id is not None:
            # A question of a text of my own.
            reading = db.get(Reading, asked.reading_id)
            if reading is not None and reading.owner_id == user.id:
                reading_ref = f"reading:{asked.reading_id}"
        if asked is not None and reading_ref is not None:
            if asked.kind == "choice":
                return Asked(
                    reading_ref,
                    asked.text,
                    "choice",
                    options=tuple(asked.options or ()),
                    right=asked.answer if asked.answer is not None else -1,
                )
            return Asked(
                reading_ref,
                asked.text,
                min_words=asked.min_words or 1,
                max_words=asked.max_words or 1,
            )
    raise ApiError(404, "question_not_found", "No such question")


def answer(
    db: Session, user: User, question_ref: str, text: str, at: datetime, choice: int | None = None
) -> None:
    """Saves the reader's answer: an open one replaces their earlier one unless that is newer; one
    to a question with options is given once, and stays."""
    asked = question(db, user, question_ref)
    kept = db.scalar(
        select(ReadingAnswer).where(
            ReadingAnswer.user_id == user.id, ReadingAnswer.question_ref == question_ref
        )
    )
    correct: bool | None = None
    if asked.kind == "choice":
        if choice is None or not 0 <= choice < len(asked.options):
            raise ApiError(422, "answer_no_choice", "Pick one of the options")
        if kept is not None:
            raise ApiError(409, "answer_final", "This question was answered already")
        text, correct = asked.options[choice], choice == asked.right
        words = 0
    else:
        if choice is not None:
            raise ApiError(422, "answer_no_choice", "This question has no options")
        text = text.strip()
        words = count_words(text)
        if words > MAX_ANSWER_WORDS or words > asked.max_words:
            raise ApiError(422, "answer_too_long", f"At most {asked.max_words} words")
        if words < asked.min_words:
            raise ApiError(422, "answer_too_short", f"At least {asked.min_words} words")
    if kept is None:
        db.add(
            ReadingAnswer(
                id=uuid.uuid4(),
                user_id=user.id,
                question_ref=question_ref,
                reading_ref=asked.reading_ref,
                question_text=asked.text,
                text=text,
                words=words,
                choice=choice,
                correct=correct,
                sent_at=at,
                updated_at=at,
            )
        )
    elif at >= kept.updated_at:
        kept.text = text
        kept.words = words
        kept.question_text = asked.text
        kept.updated_at = at
    db.flush()


def answers(db: Session, user: User, reading_ref: str) -> list[AnswerOut]:
    rows = db.scalars(
        select(ReadingAnswer)
        .where(ReadingAnswer.user_id == user.id, ReadingAnswer.reading_ref == reading_ref)
        .order_by(ReadingAnswer.question_ref)
    )
    return [
        AnswerOut(
            question_ref=row.question_ref,
            question_text=row.question_text,
            text=row.text,
            words=row.words,
            sent_at=row.sent_at,
            updated_at=row.updated_at,
            choice=row.choice,
            correct=row.correct,
        )
        for row in rows
    ]


def counts(db: Session, user: User) -> dict[str, int]:
    """How many questions of each text the reader has answered: for the library's rows."""
    rows = db.execute(
        select(ReadingAnswer.reading_ref, func.count())
        .where(ReadingAnswer.user_id == user.id)
        .group_by(ReadingAnswer.reading_ref)
    )
    return {reading_ref: count for reading_ref, count in rows}
