"""mentor daily minutes: how long the learner wants to study each day

Revision ID: d3f1a2b4c5e6
Revises: c1a4e9d7f2b8
Create Date: 2026-11-15 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3f1a2b4c5e6"
down_revision: str | Sequence[str] | None = "c1a4e9d7f2b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mentor_daily_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "mentor_daily_minutes")
