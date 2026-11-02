"""lesson set aside (ADR 0035)

Revision ID: 0a04b4717094
Revises: 7fb12aa844da
Create Date: 2026-10-30 23:19:59.917643

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0a04b4717094"
down_revision: str | Sequence[str] | None = "7fb12aa844da"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEX = "uq_learning_sessions_open_per_user"


def upgrade() -> None:
    op.add_column(
        "learning_sessions", sa.Column("set_aside_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Open now means neither finished nor set aside.
    op.drop_index(INDEX, table_name="learning_sessions")
    op.create_index(
        INDEX,
        "learning_sessions",
        ["user_id", sa.text("(kind = 'spelling')")],
        unique=True,
        postgresql_where=sa.text("completed_at IS NULL AND set_aside_at IS NULL"),
    )


def downgrade() -> None:
    # Before set-aside lessons existed, a lesson was either open or finished: close them.
    op.execute(
        "UPDATE learning_sessions SET completed_at = set_aside_at WHERE set_aside_at IS NOT NULL"
    )
    op.drop_index(INDEX, table_name="learning_sessions")
    op.create_index(
        INDEX,
        "learning_sessions",
        ["user_id", sa.text("(kind = 'spelling')")],
        unique=True,
        postgresql_where=sa.text("completed_at IS NULL"),
    )
    op.drop_column("learning_sessions", "set_aside_at")
