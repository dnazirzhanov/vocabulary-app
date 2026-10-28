"""spelling

Revision ID: 7c2f9a4e6b11
Revises: 5b7e1d9c3a20
Create Date: 2026-10-28 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c2f9a4e6b11"
down_revision: str | Sequence[str] | None = "5b7e1d9c3a20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0016: a spelling session of today's new words; its answers (exercise_type 'spelling')
    # fit the attempts table as it is.
    op.add_column(
        "learning_sessions", sa.Column("spelling_words", sa.SmallInteger(), nullable=True)
    )
    op.drop_constraint(op.f("ck_learning_sessions_kind"), "learning_sessions", type_="check")
    op.create_check_constraint(
        "kind",
        "learning_sessions",
        "kind IN ('new', 'practice', 'review', 'study', 'hard', 'spelling')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM learning_sessions WHERE kind = 'spelling'")
    op.drop_constraint(op.f("ck_learning_sessions_kind"), "learning_sessions", type_="check")
    op.create_check_constraint(
        "kind", "learning_sessions", "kind IN ('new', 'practice', 'review', 'study', 'hard')"
    )
    op.drop_column("learning_sessions", "spelling_words")
