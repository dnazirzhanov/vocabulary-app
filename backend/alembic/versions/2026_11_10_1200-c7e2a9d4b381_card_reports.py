"""card reports: a learner says a card's translation or example is wrong

Revision ID: c7e2a9d4b381
Revises: a3d6f8b2c917
Create Date: 2026-11-10 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7e2a9d4b381"
down_revision: str | Sequence[str] | None = "a3d6f8b2c917"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "card_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("word_id", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "reason IN ('translation', 'example', 'other')", name=op.f("ck_card_reports_reason")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_card_reports_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["word_id"],
            ["words.id"],
            name=op.f("fk_card_reports_word_id_words"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_card_reports")),
    )
    op.create_index(op.f("ix_card_reports_user_id"), "card_reports", ["user_id"])
    op.create_index(op.f("ix_card_reports_word_id"), "card_reports", ["word_id"])
    op.create_index(
        "uq_card_reports_open",
        "card_reports",
        ["user_id", "word_id"],
        unique=True,
        postgresql_where=sa.text("resolved_at IS NULL"),
    )
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE card_reports ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("card_reports")
