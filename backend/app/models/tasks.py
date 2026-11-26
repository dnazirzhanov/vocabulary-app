"""«Планы» (ADR 0084): a learner's to-dos, TickTick-style. A task has a date (or none: «Входящие»),
an optional time, and may repeat on weekdays; each day it is done or skipped is a mark. A group's
task (ADR 0085) has a `group_id` instead of a `user_id`, and each member marks it for themselves.
Times are minutes from midnight on the learner's own clock."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("(user_id IS NULL) <> (group_id IS NULL)", name="ck_tasks_one_owner"),
        CheckConstraint("priority BETWEEN 0 AND 3", name="ck_tasks_priority"),
        CheckConstraint("repeat_mask BETWEEN 0 AND 127", name="ck_tasks_repeat_mask"),
        CheckConstraint(
            "start_minute IS NULL OR start_minute BETWEEN 0 AND 1439", name="ck_tasks_start"
        ),
        CheckConstraint("kind IN ('task', 'study')", name="ck_tasks_kind"),
        CheckConstraint("repeat_mask = 0 OR due_on IS NOT NULL", name="ck_tasks_repeat_dated"),
        Index("ix_tasks_user", "user_id"),
        Index("ix_tasks_group", "group_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Exactly one of the two: a learner's own task, or a group's (set by its teacher).
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str] = mapped_column(Text, default="")
    # The day it is due; for a repeating task, the first day of the series. Null: no date.
    due_on: Mapped[date | None] = mapped_column(Date)
    start_minute: Mapped[int | None] = mapped_column(SmallInteger)
    # Weekdays it repeats on (Monday = 1 … Sunday = 64, as promises); 0: it doesn't repeat.
    repeat_mask: Mapped[int] = mapped_column(SmallInteger, default=0)
    # The last day of a repeating series ended by an edit «this and future»; null: no end.
    repeat_until: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[int] = mapped_column(SmallInteger, default=0)
    # A study task is also done on a day the learner practised (ADR 0086).
    kind: Mapped[str] = mapped_column(String(8), default="task")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskMark(Base):
    """One day of a task, for one learner: done, or skipped («Пропустить сегодня»)."""

    __tablename__ = "task_marks"
    __table_args__ = (
        UniqueConstraint("task_id", "user_id", "on", name="uq_task_marks_day"),
        CheckConstraint("state IN ('done', 'skipped')", name="ck_task_marks_state"),
        Index("ix_task_marks_user_on", "user_id", "on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    on: Mapped[date] = mapped_column(Date)
    state: Mapped[str] = mapped_column(String(8))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
