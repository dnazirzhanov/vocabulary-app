"""choice questions: three questions with options on a text's facts, two open ones

Revision ID: e7a1c3f9b026
Revises: d9e2b5c8a147
Create Date: 2026-11-12 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e7a1c3f9b026"
down_revision: str | Sequence[str] | None = "d9e2b5c8a147"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive: the running version writes open questions with limits, which the new check allows.
    op.add_column(
        "reading_questions",
        sa.Column("kind", sa.String(length=6), server_default="open", nullable=False),
    )
    op.add_column(
        "reading_questions",
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("reading_questions", sa.Column("answer", sa.SmallInteger(), nullable=True))
    op.alter_column("reading_questions", "min_words", nullable=True)
    op.alter_column("reading_questions", "max_words", nullable=True)
    op.drop_constraint(op.f("ck_reading_questions_limits"), "reading_questions", type_="check")
    op.create_check_constraint(
        op.f("ck_reading_questions_kinds"),
        "reading_questions",
        "(kind = 'choice' AND answer IS NOT NULL) OR (kind = 'open' AND min_words >= 1"
        " AND min_words <= max_words AND max_words <= 500)",
    )
    op.add_column("reading_answers", sa.Column("choice", sa.SmallInteger(), nullable=True))
    op.add_column("reading_answers", sa.Column("correct", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("reading_answers", "correct")
    op.drop_column("reading_answers", "choice")
    op.execute("DELETE FROM reading_questions WHERE kind = 'choice'")
    op.drop_constraint(op.f("ck_reading_questions_kinds"), "reading_questions", type_="check")
    op.create_check_constraint(
        op.f("ck_reading_questions_limits"),
        "reading_questions",
        "min_words >= 1 AND min_words <= max_words AND max_words <= 500",
    )
    op.alter_column("reading_questions", "max_words", nullable=False)
    op.alter_column("reading_questions", "min_words", nullable=False)
    op.drop_column("reading_questions", "answer")
    op.drop_column("reading_questions", "options")
    op.drop_column("reading_questions", "kind")
