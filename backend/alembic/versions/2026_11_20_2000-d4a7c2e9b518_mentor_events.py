"""mentor events: what measurement needs and the timeline doesn't have (ADR 0078)

Revision ID: d4a7c2e9b518
Revises: c1f6b3e5a427
Create Date: 2026-11-20 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4a7c2e9b518"
down_revision: str | Sequence[str] | None = "c1f6b3e5a427"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mentor_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("name", sa.String(length=24), nullable=False),
        sa.Column("props", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "name IN ('chat_message', 'start_tapped')", name="ck_mentor_events_name"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mentor_events_at", "mentor_events", ["at"])
    op.create_index("ix_mentor_events_user_at", "mentor_events", ["user_id", "at"])
    op.execute("ALTER TABLE mentor_events ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_mentor_events_user_at", table_name="mentor_events")
    op.drop_index("ix_mentor_events_at", table_name="mentor_events")
    op.drop_table("mentor_events")
