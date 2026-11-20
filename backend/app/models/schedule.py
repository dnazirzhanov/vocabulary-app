"""Schedule events: recurring weekly life commitments (school, work, sport, chores).

The mentor uses this to know when the learner is busy and what fits in the gaps. Times are
stored in minutes-from-midnight in the learner's local clock — the event "every Monday 8:00"
does not shift with DST."""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, SmallInteger, String, func
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
    # Set: a block on this date only (ADR 0074); `weekdays` then holds that date's weekday.
    on_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ScheduleSkip(Base):
    """A repeating block that isn't happening on one date: «завтра нет школы» (ADR 0074)."""

    __tablename__ = "schedule_skips"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schedule_events.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)


class MentorDayOverride(Base):
    """What the learner chose when today didn't work (ADR 0074): the 5-minute minimum, the plan
    moved to a later time, or today skipped (moved to tomorrow, never doubled)."""

    __tablename__ = "mentor_day_overrides"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    mode: Mapped[str] = mapped_column(String(12))
    start_minute: Mapped[int | None] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
