"""schedule events: weekly recurring life commitments the mentor plans around

Revision ID: e4a8b2c7d913
Revises: d3f1a2b4c5e6
Create Date: 2026-11-15 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4a8b2c7d913"
down_revision: str | Sequence[str] | None = "d3f1a2b4c5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "schedule_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("weekdays", sa.SmallInteger(), nullable=False),
        sa.Column("start_minute", sa.SmallInteger(), nullable=False),
        sa.Column("end_minute", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "weekdays BETWEEN 1 AND 127", name=op.f("ck_schedule_events_weekdays_range")
        ),
        sa.CheckConstraint(
            "start_minute >= 0 AND start_minute < 1440",
            name=op.f("ck_schedule_events_start_range"),
        ),
        sa.CheckConstraint(
            "end_minute > start_minute AND end_minute <= 1440",
            name=op.f("ck_schedule_events_end_range"),
        ),
        sa.CheckConstraint(
            "kind IN ('school', 'work', 'sport', 'chore', 'personal', 'other')",
            name=op.f("ck_schedule_events_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_schedule_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_schedule_events")),
    )
    op.create_index(op.f("ix_schedule_events_user_id"), "schedule_events", ["user_id"])
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE schedule_events ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("schedule_events")
