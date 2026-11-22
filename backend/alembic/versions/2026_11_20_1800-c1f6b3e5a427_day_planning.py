"""day planning: day types, and rest, play and sleep blocks (ADR 0076)

Revision ID: c1f6b3e5a427
Revises: b9e5a2d4f316
Create Date: 2026-11-20 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1f6b3e5a427"
down_revision: str | Sequence[str] | None = "b9e5a2d4f316"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "'school', 'work', 'sport', 'chore', 'personal', 'other'"
NEW = OLD + ", 'rest', 'play', 'sleep'"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_schedule_events_kind"), "schedule_events", type_="check")
    op.create_check_constraint(
        op.f("ck_schedule_events_kind"), "schedule_events", f"kind IN ({NEW})"
    )
    op.create_table(
        "mentor_day_types",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("type", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('study', 'light', 'weekend', 'sick', 'exam')",
            name="ck_mentor_day_types_type",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "date"),
    )
    op.execute("ALTER TABLE mentor_day_types ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("mentor_day_types")
    op.execute("DELETE FROM schedule_events WHERE kind IN ('rest', 'play', 'sleep')")
    op.drop_constraint(op.f("ck_schedule_events_kind"), "schedule_events", type_="check")
    op.create_check_constraint(
        op.f("ck_schedule_events_kind"), "schedule_events", f"kind IN ({OLD})"
    )
