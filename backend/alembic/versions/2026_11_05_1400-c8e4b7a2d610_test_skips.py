"""a group test's words can be skipped (ADR 0048)

Revision ID: c8e4b7a2d610
Revises: a7d3c5e19f42
Create Date: 2026-11-05 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8e4b7a2d610"
down_revision: str | Sequence[str] | None = "a7d3c5e19f42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "test_questions",
        sa.Column("skips", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("test_questions", "skips")
