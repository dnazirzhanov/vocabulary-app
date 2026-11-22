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
    __table_args__ = (Index("ix_mentor_messages_conversation", "conversation_id", "created_at"),)

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
    __table_args__ = (Index("ix_mentor_conversations_user_updated", "user_id", "updated_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # What the chat was about, in a few lines (ADR 0075), and how many messages it covers.
    summary: Mapped[str | None] = mapped_column(Text)
    summarized_messages: Mapped[int | None] = mapped_column()


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


class LearnerFact(Base):
    """Something the mentor knows about a learner (ADR 0075): why they learn, what they like or
    dislike, what limits their time, when they have energy, their own words for things. The
    learner sees and edits every one; a changed fact is kept as superseded."""

    __tablename__ = "learner_facts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # why, likes, dislikes, constraint, energy, word, other (check in the migration).
    kind: Mapped[str] = mapped_column(String(12))
    text: Mapped[str] = mapped_column(String(200))
    # chat (proposed by the mentor, confirmed by a tap), user (written on the page), coach.
    source: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MentorTimelineEvent(Base):
    """What happened with a learner's plan, dated (ADR 0075): a goal set, the time moved, a day
    rescued, a pause, an adjustment. Written by the coach, read back by the mentor."""

    __tablename__ = "mentor_timeline"
    __table_args__ = (Index("ix_mentor_timeline_user_at", "user_id", "at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(24))
    note: Mapped[dict[str, Any]] = mapped_column(JSONB)


class MentorEvent(Base):
    """What measurement needs that the timeline doesn't hold (ADR 0078): each chat answer's
    timing and token use, and each «Начать» tapped. Not shown to the learner; deleted with them."""

    __tablename__ = "mentor_events"
    __table_args__ = (
        Index("ix_mentor_events_at", "at"),
        Index("ix_mentor_events_user_at", "user_id", "at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # chat_message, start_tapped. Check constraint in the migration.
    name: Mapped[str] = mapped_column(String(24))
    props: Mapped[dict[str, Any]] = mapped_column(JSONB)
