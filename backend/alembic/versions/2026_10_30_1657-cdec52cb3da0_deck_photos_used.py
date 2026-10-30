"""deck photos used (ADR 0029)

Revision ID: cdec52cb3da0
Revises: 8ea40dc1b6f3
Create Date: 2026-10-30 16:57:24.498422

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cdec52cb3da0"
down_revision: str | Sequence[str] | None = "8ea40dc1b6f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "decks",
        sa.Column("photos_used", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("decks", "photos_used")
