"""Texts people add to Reading Mode themselves, and the categories they keep them in.

The library's own articles are static files (content/reading/); these live here, one owner each,
private until given to a group (round 2, R2-D).
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ReadingCategory(Base):
    """A name a person files their own texts under («Мои категории»)."""

    __tablename__ = "reading_categories"
    __table_args__ = (
        Index("uq_reading_categories_name", "owner_id", func.lower("name"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Reading(Base):
    """A text someone added: its paragraphs and, once drafted, every word's meaning."""

    __tablename__ = "readings"
    __table_args__ = (CheckConstraint("status IN ('drafting', 'ready', 'failed')", name="status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Deleting a category keeps its texts, outside any category.
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reading_categories.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(120))
    # Paragraphs, in order.
    body: Mapped[list[str]] = mapped_column(JSONB)
    words: Mapped[int] = mapped_column(Integer)
    # The language its meanings are written in: the owner's card language when it was added.
    language: Mapped[str] = mapped_column(String(2))
    level: Mapped[str | None] = mapped_column(String(2))
    # Every word form → {l: lemma, p: part of speech or null, t: meaning, d: explanation or null},
    # the static articles' shape with the meaning under `t`. Empty while drafting.
    glossary: Mapped[dict[str, dict[str, str | None]]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReadingQuestion(Base):
    """A comprehension question on a text of someone's own: drafted with its meanings (round 2).
    The library's articles keep theirs in content/reading/."""

    __tablename__ = "reading_questions"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'choice' AND answer IS NOT NULL) OR (kind = 'open' AND min_words >= 1"
            " AND min_words <= max_words AND max_words <= 500)",
            name="kinds",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reading_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("readings.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(SmallInteger)
    # 'choice': on the text's facts, with `options` and the right one's place (`answer`); 'open':
    # to infer and think, within `min_words`–`max_words`.
    kind: Mapped[str] = mapped_column(String(6), server_default="open")
    text: Mapped[str] = mapped_column(String(300))
    options: Mapped[list[str] | None] = mapped_column(JSONB)
    answer: Mapped[int | None] = mapped_column(SmallInteger)
    min_words: Mapped[int | None] = mapped_column(SmallInteger)
    max_words: Mapped[int | None] = mapped_column(SmallInteger)


class ReadingAnswer(Base):
    """A reader's answer to a question, the latest one: theirs to read again whenever they like."""

    __tablename__ = "reading_answers"
    __table_args__ = (UniqueConstraint("user_id", "question_ref"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # `library:<article>:<n>`, or `question:<id>` for one on a text of someone's own.
    question_ref: Mapped[str] = mapped_column(String(80))
    # `library:<article>` or `reading:<id>`: the answers of one text are read together.
    reading_ref: Mapped[str] = mapped_column(String(80))
    # The question as it was answered: it may be changed later, the answer keeps its own.
    question_text: Mapped[str] = mapped_column(String(300))
    text: Mapped[str] = mapped_column(Text)
    words: Mapped[int] = mapped_column(SmallInteger)
    # A choice question's: the option picked (its place) and whether it was the right one. Final.
    choice: Mapped[int | None] = mapped_column(SmallInteger)
    correct: Mapped[bool | None] = mapped_column(Boolean)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


Index("ix_reading_answers_user_reading", ReadingAnswer.user_id, ReadingAnswer.reading_ref)
