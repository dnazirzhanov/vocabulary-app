import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserWordProgress(Base):
    """One row per learner and word, created when the word is introduced (ADR 0006)."""

    __tablename__ = "user_word_progress"
    __table_args__ = (
        CheckConstraint("fsrs_state BETWEEN 1 AND 3", name="fsrs_state_range"),
        Index("ix_user_word_progress_user_due", "user_id", "due_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    word_id: Mapped[str] = mapped_column(ForeignKey("words.id"), primary_key=True)
    introduced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    correct_count: Mapped[int] = mapped_column(server_default=text("0"))
    incorrect_count: Mapped[int] = mapped_column(server_default=text("0"))
    # FSRS schedule (ADR 0012): learning / review / relearning, the learning step, and the
    # memory model's stability (days) and difficulty (1–10) for this learner and word.
    fsrs_state: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
    fsrs_step: Mapped[int | None] = mapped_column(SmallInteger)
    stability: Mapped[float | None] = mapped_column(Float)
    difficulty: Mapped[float | None] = mapped_column(Float)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_count: Mapped[int] = mapped_column(server_default=text("0"))
    lapses: Mapped[int] = mapped_column(server_default=text("0"))


class SpellingProgress(Base):
    """How well a learner spells one word: a short ladder, apart from FSRS's memory of its
    meaning (ADR 0026). Created at the word's first spelling."""

    __tablename__ = "spelling_progress"
    __table_args__ = (
        CheckConstraint("rung BETWEEN 0 AND 3", name="rung_range"),
        Index("ix_spelling_progress_user_due", "user_id", "due_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    word_id: Mapped[str] = mapped_column(ForeignKey("words.id"), primary_key=True)
    # 0 hard (misspelled), 1 and 2 on the way, 3 «умеет писать».
    rung: Mapped[int] = mapped_column(SmallInteger)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_spelled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    misses: Mapped[int] = mapped_column(server_default=text("0"))


class LearningSession(Base):
    __tablename__ = "learning_sessions"
    __table_args__ = (
        # study and hard are flashcard sessions (ADR 0012); the others are kept for history.
        CheckConstraint(
            "kind IN ('new', 'practice', 'review', 'study', 'hard', 'spelling')", name="kind"
        ),
        CheckConstraint("day_target BETWEEN 0 AND 100", name="day_target_range"),
        CheckConstraint("promised_days BETWEEN 1 AND 7", name="promised_days_range"),
        # A learner has at most one unfinished lesson and one unfinished spelling (ADR 0026);
        # starting again resumes it.
        Index(
            "uq_learning_sessions_open_per_user",
            "user_id",
            text("(kind = 'spelling')"),
            unique=True,
            postgresql_where=text("completed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The deck it was studied from; null once that deck was deleted (ADR 0019): a finished lesson
    # stays as history, so the day's plan and answers on course words keep counting.
    deck_id: Mapped[str | None] = mapped_column(ForeignKey("decks.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(16))
    # The ordered exercises including answer keys; never sent to clients as-is.
    plan: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # When a study session started (ADR 0015): the day's new-word pace (0 when no new words were
    # possible; no longer judged, ADR 0027) and the days a week promised. NULL for practice.
    day_target: Mapped[int | None] = mapped_column(SmallInteger)
    promised_days: Mapped[int | None] = mapped_column(SmallInteger)
    # A spelling session (ADR 0016): how many of the day's new words it covers.
    spelling_words: Mapped[int | None] = mapped_column(SmallInteger)
    # A study session: the reviews still due when it was finished (ADR 0022). No longer recorded
    # or read since days count by any finished session (ADR 0027); kept for old rows.
    reviews_left: Mapped[int | None] = mapped_column(SmallInteger)


class ReviewAttempt(Base):
    __tablename__ = "review_attempts"
    __table_args__ = (
        # Exactly one attempt per exercise: retries and double submits return the stored result.
        UniqueConstraint("session_id", "exercise_id"),
        CheckConstraint(
            "(exercise_type IN ('introduce', 'card')) = (correct IS NULL)",
            name="correct_only_for_answers",
        ),
        CheckConstraint("(exercise_type = 'card') = (rating IS NOT NULL)", name="rating_for_cards"),
        CheckConstraint("rating BETWEEN 1 AND 4", name="rating_range"),
        Index("ix_review_attempts_user_answered", "user_id", "answered_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learning_sessions.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    word_id: Mapped[str] = mapped_column(ForeignKey("words.id"))
    exercise_id: Mapped[str] = mapped_column(String(8))
    exercise_type: Mapped[str] = mapped_column(String(24))
    # Typed text is evaluated and discarded; only the outcome is kept (privacy requirement).
    correct: Mapped[bool | None]
    answered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Flashcards: the learner's rating (1 Снова … 4 Легко), and whether the card was already in
    # review (not new or still in learning steps) when rated — the basis of the recall rate.
    rating: Mapped[int | None] = mapped_column(SmallInteger)
    was_review: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # Set on the attempt that (re)scheduled the word: introductions and a review's last exercise.
    stage_after: Mapped[int | None] = mapped_column(SmallInteger)
    due_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Awarded once, when the attempt is written (services/progress.py).
    points: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
