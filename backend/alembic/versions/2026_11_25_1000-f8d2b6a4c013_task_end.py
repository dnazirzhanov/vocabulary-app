"""tasks: an optional end time («с 19:00 до 20:00»), ADR 0087

Revision ID: f8d2b6a4c013
Revises: e7c1a5f3b902
Create Date: 2026-11-25 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f8d2b6a4c013"
down_revision: str | Sequence[str] | None = "e7c1a5f3b902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("end_minute", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "ck_tasks_end",
        "tasks",
        "end_minute IS NULL OR (start_minute IS NOT NULL AND end_minute > start_minute"
        " AND end_minute <= 1440)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_tasks_end", "tasks", type_="check")
    op.drop_column("tasks", "end_minute")
