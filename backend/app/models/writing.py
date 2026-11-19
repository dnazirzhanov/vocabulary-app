"""Writing feature ORM model: one row per submitted answer, with its AI feedback."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WritingSubmission(Base):
    """A learner's written answer and its evaluation.

    `client_id` is made by the browser once per attempt: a double tap or a retry after a failed
    evaluation carries the same id, so it can never create a second row. `status` is `pending`
    while the model is being asked, then `done` or `failed` (the answer is kept either way)."""

    __tablename__ = "writing_submissions"
    __table_args__ = (UniqueConstraint("user_id", "client_id", name="uq_writing_user_client"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    client_id: Mapped[uuid.UUID] = mapped_column()
    # Into the static question bank (services/writing/questions.py), not a foreign key.
    question_id: Mapped[str] = mapped_column(String(64), index=True)
    answer: Mapped[str] = mapped_column(Text)
    time_spent_seconds: Mapped[int | None] = mapped_column(Integer)
    feedback_language: Mapped[str] = mapped_column(String(8), server_default="en")
    status: Mapped[str] = mapped_column(String(16), server_default="pending")
    failure_code: Mapped[str | None] = mapped_column(String(64))
    evaluation: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    model: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
