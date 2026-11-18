"""Schedule events: recurring weekly life commitments (school, work, sport, chores).

The mentor uses this to know when the learner is busy and what fits in the gaps. Times are
stored in minutes-from-midnight in the learner's local clock — the event "every Monday 8:00"
does not shift with DST."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ScheduleEvent(Base):
    __tablename__ = "schedule_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(80))
    # One of: school, work, sport, chore, personal, other. Check constraint in the migration.
    kind: Mapped[str] = mapped_column(String(16))
    # Weekdays bitmask, same encoding as PromiseChange: Monday = 1, Sunday = 64.
    weekdays: Mapped[int] = mapped_column(SmallInteger)
    # Local-clock minutes from midnight; start_minute < end_minute, end_minute ≤ 1440.
    start_minute: Mapped[int] = mapped_column(SmallInteger)
    end_minute: Mapped[int] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
