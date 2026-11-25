"""prompt glossaries: a Writing or Speaking question's word meanings, kept (ADR 0091)

Revision ID: b2c4d6e8f013
Revises: a1b3c5d7e902
Create Date: 2026-11-25 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b2c4d6e8f013"
down_revision: str | Sequence[str] | None = "a1b3c5d7e902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "prompt_glossaries",
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=False),
        sa.Column("language", sa.String(length=8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("glossary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("kind", "question_id", "language"),
    )
    op.execute("ALTER TABLE prompt_glossaries ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("prompt_glossaries")
