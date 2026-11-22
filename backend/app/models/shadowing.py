"""Shadowing feature ORM models."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ShadowingExercise(Base):
    """A curated audio exercise for the shadowing feature."""

    __tablename__ = "shadowing_exercises"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text)
    difficulty: Mapped[str] = mapped_column(String(16))  # beginner / intermediate / advanced
    language: Mapped[str] = mapped_column(String(8), server_default="en")
    duration_ms: Mapped[int] = mapped_column(Integer)
    transcript: Mapped[str] = mapped_column(Text)
    sentences: Mapped[list[Any]] = mapped_column(JSON, server_default="[]")
    speaker: Mapped[str | None] = mapped_column(String(128))
    audio_path: Mapped[str] = mapped_column(Text, server_default="")
    audio_mime_type: Mapped[str] = mapped_column(String(64), server_default="audio/webm")
    display_order: Mapped[int] = mapped_column(Integer, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShadowingAttempt(Base):
    """One shadowing attempt by a learner for an exercise."""

    __tablename__ = "shadowing_attempts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    exercise_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shadowing_exercises.id", ondelete="CASCADE"), index=True
    )
    audio_path: Mapped[str | None] = mapped_column(Text)
    audio_mime_type: Mapped[str | None] = mapped_column(String(64))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
