"""coach: goals, a study time on promises, weekly adjustments (ADR 0071)

Revision ID: e4b2d6a8c013
Revises: d1a7c3e5f902
Create Date: 2026-11-20 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e4b2d6a8c013"
down_revision: str | Sequence[str] | None = "d1a7c3e5f902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = "'ielts', 'conversation', 'travel', 'business', 'academic', 'general'"


def upgrade() -> None:
    op.create_table(
        "mentor_goals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("target", sa.String(length=8), nullable=True),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("why", sa.String(length=300), nullable=True),
        sa.Column("start_level", sa.String(length=2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"kind IN ({KINDS})", name="ck_mentor_goals_kind"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mentor_goals_user_id", "mentor_goals", ["user_id"])
    # One active goal per learner.
    op.create_index(
        "uq_mentor_goals_active",
        "mentor_goals",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.execute("ALTER TABLE mentor_goals ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "mentor_adjustments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("evidence", postgresql.JSONB(), nullable=False),
        sa.Column("proposal", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('proposed', 'accepted', 'dismissed')", name="ck_mentor_adjustments_status"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "week_start", name="uq_mentor_adjustment_week"),
    )
    op.execute("ALTER TABLE mentor_adjustments ENABLE ROW LEVEL SECURITY")

    op.add_column("promise_changes", sa.Column("start_minute", sa.SmallInteger(), nullable=True))
    op.add_column("promise_changes", sa.Column("minutes", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "ck_promise_changes_study_time",
        "promise_changes",
        "(start_minute IS NULL AND minutes IS NULL) OR "
        "(start_minute BETWEEN 0 AND 1439 AND minutes BETWEEN 5 AND 180)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_promise_changes_study_time", "promise_changes", type_="check")
    op.drop_column("promise_changes", "minutes")
    op.drop_column("promise_changes", "start_minute")
    op.drop_table("mentor_adjustments")
    op.drop_index("uq_mentor_goals_active", table_name="mentor_goals")
    op.drop_index("ix_mentor_goals_user_id", table_name="mentor_goals")
    op.drop_table("mentor_goals")
