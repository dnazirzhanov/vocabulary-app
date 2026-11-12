"""Texts people add to Reading Mode (round 2): saved at once, their meanings drafted after.

Adding a text answers straight away; a model then writes every word form's meaning as it is used
in this text, in the owner's card language, in batches, and the reader shows them once ready.
A form the model leaves out falls back to the course glossary (Russian), else the reader says it
has no meaning yet, never a blank.
"""

import math
import re
import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_sessionmaker
from app.core.errors import ApiError
from app.core.logging import logger
from app.models import GlossaryForm, Reading, ReadingCategory, ReadingQuestion, User
from app.schemas.readings import (
    CategoryIn,
    CategoryOut,
    NewReadingIn,
    QuestionOut,
    ReadingCardOut,
    ReadingChangeIn,
    ReadingListOut,
    ReadingOut,
)
from app.services.content import TOKEN
from app.services.generation import DraftQuestion, Gloss, Provider
from app.services.reading import MAX_ANSWER_WORDS, READING_SPEED

MAX_WORDS = 2000
MAX_READINGS = 200
MAX_CATEGORIES = 50
# Forms per model call: about 5,000 tokens of answer, well inside its limit.
GLOSS_BATCH = 150
# Questions drafted with a text's meanings: three with options, two open (round 2, the owner's).
QUESTIONS_PER_TEXT = 5
_LINE_BREAK_HYPHEN = re.compile(r"(\w)-\n(\w)")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


def paragraphs(text: str) -> list[str]:
    """Pasted or photographed text as paragraphs: blank lines part them; a word hyphenated at a
    line's end is joined; curly apostrophes are made straight, as the tokenizer reads them."""
    text = text.replace("\r\n", "\n").replace("’", "'").replace("‘", "'")
    text = _LINE_BREAK_HYPHEN.sub(r"\1\2", text)
    parts = (" ".join(part.split()) for part in _PARAGRAPH_BREAK.split(text))
    return [part for part in parts if part]


def forms_of(body: list[str]) -> list[str]:
    """Every word form, lowercase, in the order first met."""
    return list(
        dict.fromkeys(match.group(0).lower() for part in body for match in TOKEN.finditer(part))
    )


def _word_count(body: list[str]) -> int:
    return sum(len(TOKEN.findall(part)) for part in body)


def _minutes(words: int, level: str | None) -> int:
    return max(1, math.ceil(words / READING_SPEED.get(level or "B1", READING_SPEED["B1"])))


def _card(reading: Reading) -> ReadingCardOut:
    return ReadingCardOut(
        id=reading.id,
        title=reading.title,
        category_id=reading.category_id,
        level=reading.level,
        words=reading.words,
        minutes=_minutes(reading.words, reading.level),
        status=reading.status,
        created_at=reading.created_at,
    )


def _out(reading: Reading, questions: list[ReadingQuestion] | None = None) -> ReadingOut:
    return ReadingOut(
        **_card(reading).model_dump(),
        body=reading.body,
        language=reading.language,
        glossary=reading.glossary,
        questions=[
            QuestionOut(
                id=f"question:{one.id}",
                kind=one.kind,
                q=one.text,
                options=one.options,
                answer=one.answer,
                min=one.min_words,
                max=one.max_words,
            )
            for one in questions or []
        ],
    )


def _questions(db: Session, reading: Reading) -> list[ReadingQuestion]:
    return list(
        db.scalars(
            select(ReadingQuestion)
            .where(ReadingQuestion.reading_id == reading.id)
            .order_by(ReadingQuestion.position)
        )
    )


def _own(db: Session, user: User, reading_id: uuid.UUID) -> Reading:
    reading = db.get(Reading, reading_id)
    # Someone else's text looks like one that doesn't exist.
    if reading is None or reading.owner_id != user.id:
        raise ApiError(404, "reading_not_found", "No such text")
    return reading


def _own_category(db: Session, user: User, category_id: uuid.UUID) -> ReadingCategory:
    category = db.get(ReadingCategory, category_id)
    if category is None or category.owner_id != user.id:
        raise ApiError(404, "category_not_found", "No such category")
    return category


# --- texts ----------------------------------------------------------------------------------


def library(db: Session, user: User) -> ReadingListOut:
    categories = db.scalars(
        select(ReadingCategory)
        .where(ReadingCategory.owner_id == user.id)
        .order_by(func.lower(ReadingCategory.name))
    )
    readings = db.scalars(
        select(Reading).where(Reading.owner_id == user.id).order_by(Reading.created_at.desc())
    )
    asked = dict(
        db.execute(
            select(ReadingQuestion.reading_id, func.count())
            .join(Reading, Reading.id == ReadingQuestion.reading_id)
            .where(Reading.owner_id == user.id)
            .group_by(ReadingQuestion.reading_id)
        ).all()
    )
    return ReadingListOut(
        categories=[CategoryOut(id=one.id, name=one.name) for one in categories],
        readings=[
            _card(one).model_copy(update={"questions_count": asked.get(one.id, 0)})
            for one in readings
        ],
    )


def create(db: Session, user: User, body: NewReadingIn, now: datetime) -> ReadingOut:
    parts = paragraphs(body.text)
    words = _word_count(parts)
    if words == 0:
        raise ApiError(422, "reading_empty", "The text has no English words")
    if words > MAX_WORDS:
        raise ApiError(422, "reading_too_long", f"A text is at most {MAX_WORDS} words")
    if body.category_id is not None:
        _own_category(db, user, body.category_id)
    count = db.scalar(select(func.count()).where(Reading.owner_id == user.id)) or 0
    if count >= MAX_READINGS:
        raise ApiError(409, "too_many_readings", f"At most {MAX_READINGS} texts")
    reading = Reading(
        id=uuid.uuid4(),
        owner_id=user.id,
        category_id=body.category_id,
        title=body.title,
        body=parts,
        words=words,
        language=user.language or "ru",
        level=None,
        glossary={},
        status="drafting",
        created_at=now,
        updated_at=now,
    )
    db.add(reading)
    db.commit()
    return _out(reading)


def get(db: Session, user: User, reading_id: uuid.UUID) -> ReadingOut:
    """A text of mine, or one given to a group of mine (its questions are then the giving's)."""
    reading = db.get(Reading, reading_id)
    if reading is not None and reading.owner_id != user.id:
        from app.services.reading_assignments import may_read

        if may_read(db, user, reading_id):
            return _out(reading)
    reading = _own(db, user, reading_id)
    return _out(reading, _questions(db, reading))


def change(
    db: Session, user: User, reading_id: uuid.UUID, body: ReadingChangeIn, now: datetime
) -> ReadingOut:
    reading = _own(db, user, reading_id)
    if body.title is not None:
        reading.title = body.title
    if "category_id" in body.model_fields_set:
        if body.category_id is not None:
            _own_category(db, user, body.category_id)
        reading.category_id = body.category_id
    reading.updated_at = now
    db.commit()
    return _out(reading, _questions(db, reading))


def delete(db: Session, user: User, reading_id: uuid.UUID) -> None:
    db.delete(_own(db, user, reading_id))
    db.commit()


def redraft(db: Session, user: User, reading_id: uuid.UUID, now: datetime) -> ReadingOut:
    """A text whose meanings failed, asked again."""
    reading = _own(db, user, reading_id)
    if reading.status != "failed":
        raise ApiError(409, "reading_not_failed", "Its meanings are not failed")
    reading.status = "drafting"
    reading.updated_at = now
    db.commit()
    return _out(reading)


# --- meanings -------------------------------------------------------------------------------


def _entry(gloss: Gloss) -> dict[str, str | None]:
    # The static articles' shape: a name has no part of speech, so it is never offered as a card.
    return {
        "l": gloss.lemma.strip() or None,
        "p": None if gloss.pos == "name" else gloss.pos,
        "t": gloss.meaning.strip(),
        "d": (gloss.explanation or "").strip() or None,
    }


def write_meanings(db: Session, reading: Reading, provider: Provider, now: datetime) -> None:
    """Every form's meaning in this text, batch by batch; the caller has the reading locked out of
    other writers by its `drafting` status."""
    forms = forms_of(reading.body)
    text = "\n\n".join(reading.body)
    glossary: dict[str, dict[str, str | None]] = {}
    level: str | None = None
    drafted: list[DraftQuestion] = []
    for start in range(0, len(forms), GLOSS_BATCH):
        batch = forms[start : start + GLOSS_BATCH]
        # The first call also drafts the questions: no call of their own.
        answer = provider.gloss(
            text, batch, reading.language, QUESTIONS_PER_TEXT if start == 0 else 0
        )
        level = level or answer.level
        drafted = drafted or answer.questions
        wanted = set(batch)
        for form, gloss in answer.forms.items():
            key = form.lower()
            if key in wanted and gloss.meaning.strip():
                entry = _entry(gloss)
                entry["l"] = entry["l"] or key
                glossary[key] = entry
    missing = [form for form in forms if form not in glossary]
    if missing and reading.language == "ru":
        for row in db.scalars(select(GlossaryForm).where(GlossaryForm.form.in_(missing))):
            glossary[row.form] = {"l": row.lemma or row.form, "p": "other", "t": row.ru, "d": None}
    reading.glossary = glossary
    reading.level = level
    for old in _questions(db, reading):
        db.delete(old)
    for position, one in enumerate(_sound(drafted)):
        db.add(ReadingQuestion(id=uuid.uuid4(), reading_id=reading.id, position=position, **one))
    reading.status = "ready"
    reading.updated_at = now


def _sound(drafted: list[DraftQuestion]) -> list[dict[str, object]]:
    """Questions as a model may write them, made sound: choices first (3–4 different options, the
    right one among them), then open ones with 1 ≤ min ≤ max ≤ 500; anything else is left out."""
    choice: list[dict[str, object]] = []
    open_: list[dict[str, object]] = []
    for one in drafted:
        text = one.question.strip()[:300]
        if not text:
            continue
        options = [option.strip()[:120] for option in one.options or [] if option.strip()]
        if one.options is not None:
            right = one.answer if one.answer is not None else -1
            if (
                3 <= len(options) <= 4
                and len(set(options)) == len(options)
                and 0 <= right < len(options)
            ):
                choice.append({"kind": "choice", "text": text, "options": options, "answer": right})
            continue
        high = min(max(one.max_words, 1), MAX_ANSWER_WORDS)
        open_.append(
            {
                "kind": "open",
                "text": text,
                "min_words": min(max(one.min_words, 1), high),
                "max_words": high,
            }
        )
    return choice[:3] + open_[:2]


def draft_in_background(reading_id: uuid.UUID, provider: Provider, now: datetime) -> None:
    """After the answer that saved the text: its own session, as the request's is gone."""
    with get_sessionmaker()() as db:
        reading = db.get(Reading, reading_id)
        if reading is None or reading.status != "drafting":
            return
        try:
            write_meanings(db, reading, provider, now)
        except Exception as error:  # any failure: the reader offers to try again, never hangs
            db.rollback()
            code = error.code if isinstance(error, ApiError) else type(error).__name__
            logger.warning("A text's meanings failed: %s", code)
            reading = db.get(Reading, reading_id)
            if reading is None:
                return
            reading.status = "failed"
            reading.updated_at = now
        db.commit()


# --- categories ------------------------------------------------------------------------------


def add_category(db: Session, user: User, body: CategoryIn, now: datetime) -> CategoryOut:
    count = db.scalar(select(func.count()).where(ReadingCategory.owner_id == user.id)) or 0
    if count >= MAX_CATEGORIES:
        raise ApiError(409, "too_many_categories", f"At most {MAX_CATEGORIES} categories")
    category = ReadingCategory(id=uuid.uuid4(), owner_id=user.id, name=body.name, created_at=now)
    db.add(category)
    _commit_name(db)
    return CategoryOut(id=category.id, name=category.name)


def rename_category(
    db: Session, user: User, category_id: uuid.UUID, body: CategoryIn
) -> CategoryOut:
    category = _own_category(db, user, category_id)
    category.name = body.name
    _commit_name(db)
    return CategoryOut(id=category.id, name=category.name)


def delete_category(db: Session, user: User, category_id: uuid.UUID) -> None:
    """Its texts stay, outside any category."""
    db.delete(_own_category(db, user, category_id))
    db.commit()


def _commit_name(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "category_exists", "A category with this name exists") from error
