"""Answers to comprehension questions (Reading Mode, round 2): each reader's latest answer to each
question, within its word limits and never over 500 words, theirs to read again any time.

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
from app.services.content import TOKEN
from app.services.reading import MAX_ANSWER_WORDS, library_questions


def count_words(text: str) -> int:
    """Words as the reader counts them (`lib/tokens.ts`): runs of letters, apostrophes inside."""
    return len(TOKEN.findall(text))


@dataclass(frozen=True)
class Asked:
    reading_ref: str
    text: str
    min_words: int
    max_words: int


def question(db: Session, user: User, question_ref: str) -> Asked:
    """The question an answer is for, if this reader may answer it; else 404."""
    if question_ref.startswith("library:"):
        found = library_questions().get(question_ref)
        if found is not None:
            reading_ref, one = found
            return Asked(reading_ref, one.q, one.min, one.max)
    elif question_ref.startswith("question:"):
        try:
            question_id = uuid.UUID(question_ref.removeprefix("question:"))
        except ValueError:
            question_id = None
        row = (
            db.execute(
                select(ReadingQuestion, Reading.owner_id)
                .join(Reading, Reading.id == ReadingQuestion.reading_id)
                .where(ReadingQuestion.id == question_id)
            ).first()
            if question_id
            else None
        )
        # A text of the reader's own (round 2, D adds texts given to their groups).
        if row is not None and row[1] == user.id:
            asked = row[0]
            return Asked(
                f"reading:{asked.reading_id}", asked.text, asked.min_words, asked.max_words
            )
    raise ApiError(404, "question_not_found", "No such question")


def answer(db: Session, user: User, question_ref: str, text: str, at: datetime) -> None:
    """Saves the reader's answer, replacing their earlier one unless that one is newer."""
    asked = question(db, user, question_ref)
    text = text.strip()
    words = count_words(text)
    if words > MAX_ANSWER_WORDS or words > asked.max_words:
        raise ApiError(422, "answer_too_long", f"At most {asked.max_words} words")
    if words < asked.min_words:
        raise ApiError(422, "answer_too_short", f"At least {asked.min_words} words")
    kept = db.scalar(
        select(ReadingAnswer).where(
            ReadingAnswer.user_id == user.id, ReadingAnswer.question_ref == question_ref
        )
    )
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
