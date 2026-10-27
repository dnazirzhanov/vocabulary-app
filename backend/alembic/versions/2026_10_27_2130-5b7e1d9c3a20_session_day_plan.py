"""session day plan

Revision ID: 5b7e1d9c3a20
Revises: c7faf8aaaf0a
Create Date: 2026-10-27 21:30:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5b7e1d9c3a20"
down_revision: str | Sequence[str] | None = "c7faf8aaaf0a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The plan in force when a study session started (ADR 0015); NULL for practice and for
    # sessions from before this column, whose plan is reconstructed from current settings.
    op.add_column("learning_sessions", sa.Column("day_target", sa.SmallInteger(), nullable=True))
    op.add_column("learning_sessions", sa.Column("promised_days", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "day_target_range", "learning_sessions", "day_target BETWEEN 0 AND 100"
    )
    op.create_check_constraint(
        "promised_days_range", "learning_sessions", "promised_days BETWEEN 1 AND 7"
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_learning_sessions_promised_days_range"), "learning_sessions", type_="check"
    )
    op.drop_constraint(
        op.f("ck_learning_sessions_day_target_range"), "learning_sessions", type_="check"
    )
    op.drop_column("learning_sessions", "promised_days")
    op.drop_column("learning_sessions", "day_target")
