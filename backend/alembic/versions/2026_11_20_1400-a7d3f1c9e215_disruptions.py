"""disruptions: one-off blocks, single-day skips, today's rescue (ADR 0074)

Revision ID: a7d3f1c9e215
Revises: f5c3e7b9d124
Create Date: 2026-11-20 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7d3f1c9e215"
down_revision: str | Sequence[str] | None = "f5c3e7b9d124"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A block on one date only; its weekdays hold that date's weekday, so older apps still read it.
    op.add_column("schedule_events", sa.Column("on_date", sa.Date(), nullable=True))
    op.create_table(
        "schedule_skips",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["schedule_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "date"),
    )
    op.execute("ALTER TABLE schedule_skips ENABLE ROW LEVEL SECURITY")
    op.create_table(
        "mentor_day_overrides",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("mode", sa.String(length=12), nullable=False),
        sa.Column("start_minute", sa.SmallInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "mode IN ('minimum', 'moved', 'skip')", name="ck_mentor_day_overrides_mode"
        ),
        sa.CheckConstraint(
            "start_minute IS NULL OR start_minute BETWEEN 0 AND 1439",
            name="ck_mentor_day_overrides_start",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "date"),
    )
    op.execute("ALTER TABLE mentor_day_overrides ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("mentor_day_overrides")
    op.drop_table("schedule_skips")
    op.drop_column("schedule_events", "on_date")
