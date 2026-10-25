"""review scheduling

Revision ID: 5d0f6c2b9a1e
Revises: 1b2cc1422266
Create Date: 2026-10-25 23:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5d0f6c2b9a1e"
down_revision: str | Sequence[str] | None = "1b2cc1422266"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_word_progress",
        sa.Column("stage", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column("user_word_progress", sa.Column("due_at", sa.DateTime(timezone=True)))
    op.add_column("user_word_progress", sa.Column("last_reviewed_at", sa.DateTime(timezone=True)))
    op.add_column(
        "user_word_progress",
        sa.Column("review_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "user_word_progress",
        sa.Column("lapses", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    # Words met before scheduling existed get the same first review a new word gets.
    op.execute("UPDATE user_word_progress SET due_at = introduced_at + interval '1 day'")
    op.alter_column("user_word_progress", "due_at", nullable=False)
    op.create_check_constraint(
        op.f("ck_user_word_progress_stage_range"), "user_word_progress", "stage BETWEEN 1 AND 5"
    )
    op.create_index("ix_user_word_progress_user_due", "user_word_progress", ["user_id", "due_at"])

    op.drop_constraint(op.f("ck_learning_sessions_kind"), "learning_sessions", type_="check")
    op.create_check_constraint(
        op.f("ck_learning_sessions_kind"),
        "learning_sessions",
        "kind IN ('new', 'practice', 'review')",
    )

    op.add_column("review_attempts", sa.Column("stage_after", sa.SmallInteger()))
    op.add_column("review_attempts", sa.Column("due_after", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("review_attempts", "due_after")
    op.drop_column("review_attempts", "stage_after")

    # Review sessions cannot exist under the old constraint; downgrading discards them.
    op.execute("DELETE FROM learning_sessions WHERE kind = 'review'")
    op.drop_constraint(op.f("ck_learning_sessions_kind"), "learning_sessions", type_="check")
    op.create_check_constraint(
        op.f("ck_learning_sessions_kind"), "learning_sessions", "kind IN ('new', 'practice')"
    )

    op.drop_index("ix_user_word_progress_user_due", table_name="user_word_progress")
    op.drop_constraint(
        op.f("ck_user_word_progress_stage_range"), "user_word_progress", type_="check"
    )
    for column in ("lapses", "review_count", "last_reviewed_at", "due_at", "stage"):
        op.drop_column("user_word_progress", column)
