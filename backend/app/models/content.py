from sqlalchemy import ARRAY, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Deck(Base):
    __tablename__ = "decks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    learning_language: Mapped[str] = mapped_column(String(8))
    explanation_language: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(16))
    content_version: Mapped[int]
    # The course goal promised to learners (deck.yaml `course_goal`), only when it has a source.
    goal_words: Mapped[int | None]
    goal_coverage_percent: Mapped[int | None]


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


class DeckWord(Base):
    __tablename__ = "deck_words"
    __table_args__ = (UniqueConstraint("deck_id", "position"),)

    deck_id: Mapped[str] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), primary_key=True
    )
    word_id: Mapped[str] = mapped_column(ForeignKey("words.id"), primary_key=True)
    position: Mapped[int]


class GlossaryForm(Base):
    """A word form used in an example sentence and its Russian meaning, for tap-a-word."""

    __tablename__ = "glossary"

    form: Mapped[str] = mapped_column(String(64), primary_key=True)
    ru: Mapped[str] = mapped_column(String(200))
    lemma: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(String(120))
