"""Mentor chat messages: the learner's conversation with the study companion."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MentorMessage(Base):
    """One turn in a mentor conversation. Role is 'user' or 'assistant'; a small recent window
    is sent as context on each new message so the conversation feels coherent."""

    __tablename__ = "mentor_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # The chat it belongs to (ADR 0072); null only for rows from an app older than chats.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("mentor_conversations.id", ondelete="CASCADE")
    )
    # What the mentor did before answering: tool steps and their cards, in order.
    parts: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)


class MentorConversation(Base):
    """One chat with the mentor (ADR 0072), titled from its first question, renameable."""

    __tablename__ = "mentor_conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MentorGoal(Base):
    """A learner's English goal (ADR 0071). One is active (`ended_at` null); a new goal ends the
    last, so the history of goals is kept."""

    __tablename__ = "mentor_goals"
    # One active goal per learner (declared here so the models match the migration).
    __table_args__ = (
        Index(
            "uq_mentor_goals_active",
            "user_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # ielts, conversation, travel, business, academic, general (check in the migration).
    kind: Mapped[str] = mapped_column(String(16))
    # A CEFR level or an IELTS band, as the learner gave it.
    target: Mapped[str | None] = mapped_column(String(8))
    deadline: Mapped[date | None] = mapped_column(Date)
    why: Mapped[str | None] = mapped_column(String(300))
    start_level: Mapped[str | None] = mapped_column(String(2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MentorAdjustment(Base):
    """One change the weekly look back proposed (ADR 0071), with its evidence, and what the learner
    decided. At most one a week."""

    __tablename__ = "mentor_adjustments"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_mentor_adjustment_week"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    week_start: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(24))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB)
    proposal: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # proposed, accepted, dismissed
    status: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
