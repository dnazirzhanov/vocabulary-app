import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("daily_target_words BETWEEN 1 AND 100", name="daily_target_range"),
        CheckConstraint("study_days_per_week BETWEEN 1 AND 7", name="study_days_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Identity from the auth provider ("dev|<name>" in development). Never a client-supplied id.
    auth_subject: Mapped[str] = mapped_column(String(255), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Pace (ADR 0010). The target is a plan, not a cap; null until the learner has chosen one.
    daily_target_words: Mapped[int | None] = mapped_column(SmallInteger)
    study_days_per_week: Mapped[int] = mapped_column(SmallInteger, server_default=text("6"))
    ramp_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaceDismissal(Base):
    """A pace suggestion the learner said no to; the same kind stays quiet for a week."""

    __tablename__ = "pace_dismissals"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    dismissed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
