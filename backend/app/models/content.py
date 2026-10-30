import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Deck(Base):
    __tablename__ = "decks"
    __table_args__ = (CheckConstraint("kind IN ('course', 'user')", name="kind_values"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    learning_language: Mapped[str] = mapped_column(String(8))
    explanation_language: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(16))
    content_version: Mapped[int]
    # Course level ("A1–A2") and its order: learners go through levels in this order.
    level: Mapped[str | None] = mapped_column(String(16))
    level_order: Mapped[int] = mapped_column(server_default=text("0"))
    # The course goal promised to learners (deck.yaml `course_goal`), only when it has a source.
    goal_words: Mapped[int | None]
    goal_coverage_percent: Mapped[int | None]
    # 'course': the levels, loaded from content/. 'user': a deck someone wrote (ADR 0019), personal
    # until given to a group through an assignment (ADR 0017); never part of the course or its goal.
    kind: Mapped[str] = mapped_column(String(8), server_default=text("'course'"))
    # A user deck's author, the only one who may edit it; kept when the author's account goes.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Word(Base):
    __tablename__ = "words"

    # Stable slug: progress references it, so it never changes after release (ADR 0005).
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    headword: Mapped[str] = mapped_column(String(64))
    pos: Mapped[str] = mapped_column(String(16))
    translation: Mapped[str] = mapped_column(String(120))
    also_accept: Mapped[list[str]] = mapped_column(ARRAY(String(64)))
    example: Mapped[str] = mapped_column(Text)
    example_ru: Mapped[str] = mapped_column(Text)
    illustration: Mapped[str | None] = mapped_column(String(32))
    # The sentence of the teacher's material the word was drafted from (ADR 0018).
    source_sentence: Mapped[str | None] = mapped_column(Text)
    # A teacher's own word belongs to the deck it was written for (ADR 0017); course words: null.
    owner_deck_id: Mapped[str | None] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), index=True
    )


class DeckWord(Base):
    __tablename__ = "deck_words"
    __table_args__ = (UniqueConstraint("deck_id", "position"),)

    deck_id: Mapped[str] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), primary_key=True
    )
    word_id: Mapped[str] = mapped_column(ForeignKey("words.id"), primary_key=True)
    position: Mapped[int]


class DeckSeenWord(Base):
    """Every word a deck has ever had, by its key (generation.word_key), removed ones too: the AI
    never brings a deck the same word again (ADR 0019). Small: one short row per word."""

    __tablename__ = "deck_seen_words"

    deck_id: Mapped[str] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    # The word as it was first written, for the list the AI is asked to avoid.
    headword: Mapped[str] = mapped_column(String(64))


class DeckTopic(Base):
    """A topic a deck has been grown with (ADR 0019): the editor offers the last one again, and
    a different one is met with the offer of a deck of its own."""

    __tablename__ = "deck_topics"

    deck_id: Mapped[str] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), primary_key=True
    )
    # The topic as compared: lowercase, ё as е, single spaces.
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    # As the learner last wrote it, and when.
    topic: Mapped[str] = mapped_column(String(80))
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DeckAssignment(Base):
    """A group deck given to a group: its members meet the words in their daily lesson, before
    the course's (ADR 0017). Taking it back keeps the row, so a deck is never given twice."""

    __tablename__ = "deck_assignments"
    __table_args__ = (UniqueConstraint("group_id", "deck_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    deck_id: Mapped[str] = mapped_column(ForeignKey("decks.id", ondelete="CASCADE"), index=True)
    # Who gave it: they set the words, so they do not get them in their own lesson.
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GlossaryForm(Base):
    """A word form used in an example sentence and its Russian meaning, for tap-a-word."""

    __tablename__ = "glossary"

    form: Mapped[str] = mapped_column(String(64), primary_key=True)
    ru: Mapped[str] = mapped_column(String(200))
    lemma: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(String(120))
