import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserWordProgress(Base):
    """One row per learner and word. Scheduling state arrives with Phase 3."""

    __tablename__ = "user_word_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    word_id: Mapped[str] = mapped_column(ForeignKey("words.id"), primary_key=True)
    introduced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    correct_count: Mapped[int] = mapped_column(server_default=text("0"))
    incorrect_count: Mapped[int] = mapped_column(server_default=text("0"))


class LearningSession(Base):
    __tablename__ = "learning_sessions"
    __table_args__ = (
        CheckConstraint("kind IN ('new', 'practice')", name="kind"),
        # A learner has at most one unfinished session; starting again resumes it.
        Index(
            "uq_learning_sessions_open_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("completed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    deck_id: Mapped[str] = mapped_column(ForeignKey("decks.id"))
    kind: Mapped[str] = mapped_column(String(16))
    # The ordered exercises including answer keys; never sent to clients as-is.
    plan: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewAttempt(Base):
    __tablename__ = "review_attempts"
    __table_args__ = (
        # Exactly one attempt per exercise: retries and double submits return the stored result.
        UniqueConstraint("session_id", "exercise_id"),
        CheckConstraint(
            "(exercise_type = 'introduce') = (correct IS NULL)", name="correct_only_for_answers"
        ),
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
