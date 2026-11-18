"""mentor goal: a free-text learning goal the user can set for the AI mentor

Revision ID: c1a4e9d7f2b8
Revises: b2d5f8a1c347
Create Date: 2026-11-15 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1a4e9d7f2b8"
down_revision: str | Sequence[str] | None = "b2d5f8a1c347"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mentor_goal", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "mentor_goal")
