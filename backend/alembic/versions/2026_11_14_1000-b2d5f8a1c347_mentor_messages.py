"""mentor messages: per-user conversation history for the Mentor chat tab

Revision ID: b2d5f8a1c347
Revises: a5c9e2f7b318
Create Date: 2026-11-14 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2d5f8a1c347"
down_revision: str | Sequence[str] | None = "a5c9e2f7b318"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mentor_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant')", name=op.f("ck_mentor_messages_role")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_mentor_messages_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mentor_messages")),
    )
    op.create_index(
        op.f("ix_mentor_messages_user_id"), "mentor_messages", ["user_id", "created_at"]
    )
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE mentor_messages ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("mentor_messages")
