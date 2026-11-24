"""tasks and task marks: «Планы», a to-do app (ADR 0084)

Revision ID: e7c1a5f3b902
Revises: d4a7c2e9b518
Create Date: 2026-11-24 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7c1a5f3b902"
down_revision: str | Sequence[str] | None = "d4a7c2e9b518"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("group_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("start_minute", sa.SmallInteger(), nullable=True),
        sa.Column("repeat_mask", sa.SmallInteger(), nullable=False),
        sa.Column("repeat_until", sa.Date(), nullable=True),
        sa.Column("priority", sa.SmallInteger(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("(user_id IS NULL) <> (group_id IS NULL)", name="ck_tasks_one_owner"),
        sa.CheckConstraint("priority BETWEEN 0 AND 3", name="ck_tasks_priority"),
        sa.CheckConstraint("repeat_mask BETWEEN 0 AND 127", name="ck_tasks_repeat_mask"),
        sa.CheckConstraint(
            "start_minute IS NULL OR start_minute BETWEEN 0 AND 1439", name="ck_tasks_start"
        ),
        sa.CheckConstraint("kind IN ('task', 'study')", name="ck_tasks_kind"),
        sa.CheckConstraint("repeat_mask = 0 OR due_on IS NOT NULL", name="ck_tasks_repeat_dated"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_user", "tasks", ["user_id"])
    op.create_index("ix_tasks_group", "tasks", ["group_id"])
    op.execute("ALTER TABLE tasks ENABLE ROW LEVEL SECURITY")
    op.create_table(
        "task_marks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("on", sa.Date(), nullable=False),
        sa.Column("state", sa.String(length=8), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("state IN ('done', 'skipped')", name="ck_task_marks_state"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "user_id", "on", name="uq_task_marks_day"),
    )
    op.create_index("ix_task_marks_user_on", "task_marks", ["user_id", "on"])
    op.execute("ALTER TABLE task_marks ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_task_marks_user_on", table_name="task_marks")
    op.drop_table("task_marks")
    op.drop_index("ix_tasks_group", table_name="tasks")
    op.drop_index("ix_tasks_user", table_name="tasks")
    op.drop_table("tasks")
