"""open spelling alongside lesson

Revision ID: 9a3c4d2e7f10
Revises: 5e1f0a7c9b2d
Create Date: 2026-10-30 15:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9a3c4d2e7f10"
down_revision: str | Sequence[str] | None = "5e1f0a7c9b2d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0026: a paused spelling stays open beside an unfinished lesson.
    op.drop_index("uq_learning_sessions_open_per_user", table_name="learning_sessions")
    op.create_index(
        "uq_learning_sessions_open_per_user",
        "learning_sessions",
        ["user_id", sa.text("(kind = 'spelling')")],
        unique=True,
        postgresql_where=sa.text("completed_at IS NULL"),
    )


def downgrade() -> None:
    # Only one open session per learner again: close any spelling left open beside a lesson.
    op.execute(
        """
        UPDATE learning_sessions s SET completed_at = now()
        WHERE s.kind = 'spelling' AND s.completed_at IS NULL AND EXISTS (
            SELECT 1 FROM learning_sessions o
            WHERE o.user_id = s.user_id AND o.completed_at IS NULL AND o.kind <> 'spelling'
        )
        """
    )
    op.drop_index("uq_learning_sessions_open_per_user", table_name="learning_sessions")
    op.create_index(
        "uq_learning_sessions_open_per_user",
        "learning_sessions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("completed_at IS NULL"),
    )
