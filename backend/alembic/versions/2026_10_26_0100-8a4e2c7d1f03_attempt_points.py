"""attempt points

Revision ID: 8a4e2c7d1f03
Revises: 5d0f6c2b9a1e
Create Date: 2026-10-26 01:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8a4e2c7d1f03"
down_revision: str | Sequence[str] | None = "5d0f6c2b9a1e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_attempts",
        sa.Column("points", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
    )
    # One-off backfill with the rules of services/progress.py as they stand at this revision.
    op.execute(
        """
        UPDATE review_attempts AS a
        SET points = CASE
            WHEN a.exercise_type = 'introduce' THEN 10
            WHEN s.kind = 'review' AND a.stage_after >= 2 THEN 20
            WHEN s.kind = 'review' AND a.stage_after = 1 THEN 5
            ELSE 0
        END
        FROM learning_sessions AS s
        WHERE s.id = a.session_id
        """
    )


def downgrade() -> None:
    op.drop_column("review_attempts", "points")
