"""writing: submissions table

Revision ID: c8f6e2d4b310
Revises: a5c9e2f7b318
Create Date: 2026-11-18 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8f6e2d4b310"
down_revision: str | Sequence[str] | None = "a5c9e2f7b318"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "writing_submissions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("time_spent_seconds", sa.Integer(), nullable=True),
        sa.Column("feedback_language", sa.String(length=8), server_default="en", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("evaluation", sa.JSON(), nullable=True),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "client_id", name="uq_writing_user_client"),
    )
    op.create_index("ix_writing_submissions_user_id", "writing_submissions", ["user_id"])
    op.create_index("ix_writing_submissions_question_id", "writing_submissions", ["question_id"])
    op.execute("ALTER TABLE writing_submissions ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("writing_submissions")
