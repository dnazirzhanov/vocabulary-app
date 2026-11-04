"""first recall on a word's progress, totals for days whose answers are gone (ADR 0044)

Revision ID: d4a8f6b21c07
Revises: c1e7d2a94f30
Create Date: 2026-11-04 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4a8f6b21c07"
down_revision: str | Sequence[str] | None = "c1e7d2a94f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_word_progress",
        sa.Column("first_recalled_at", sa.DateTime(timezone=True), nullable=True),
    )
    # What «знаю» has counted until now, so nobody's number changes.
    op.execute(
        """
        UPDATE user_word_progress AS progress
        SET first_recalled_at = first.at
        FROM (
            SELECT user_id, word_id, min(answered_at) AS at
            FROM review_attempts
            WHERE was_review AND rating >= 2
            GROUP BY user_id, word_id
        ) AS first
        WHERE progress.user_id = first.user_id AND progress.word_id = first.word_id
        """
    )
    op.create_table(
        "study_day_totals",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("answers", sa.Integer(), nullable=False),
        sa.Column("finished", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_study_day_totals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "day", name=op.f("pk_study_day_totals")),
    )
    op.create_index(
        "ix_learning_sessions_to_clean_up",
        "learning_sessions",
        ["completed_at"],
        unique=False,
        postgresql_where=sa.text("completed_at IS NOT NULL AND plan <> '[]'::jsonb"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_learning_sessions_to_clean_up",
        table_name="learning_sessions",
        postgresql_where=sa.text("completed_at IS NOT NULL AND plan <> '[]'::jsonb"),
    )
    op.drop_table("study_day_totals")
    op.drop_column("user_word_progress", "first_recalled_at")
