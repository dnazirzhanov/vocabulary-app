"""deck levels

Revision ID: c7faf8aaaf0a
Revises: e9bc9fb75ecc
Create Date: 2026-10-26 22:38:36

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7faf8aaaf0a"
down_revision: str | Sequence[str] | None = "e9bc9fb75ecc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("decks", sa.Column("level", sa.String(length=16), nullable=True))
    op.add_column(
        "decks", sa.Column("level_order", sa.Integer(), server_default=sa.text("0"), nullable=False)
    )
    # The starter deck's words now live in the A1–A2 deck; old sessions still point at it.
    op.execute("UPDATE decks SET status = 'draft' WHERE id = 'starter'")


def downgrade() -> None:
    op.execute("UPDATE decks SET status = 'published' WHERE id = 'starter'")
    op.drop_column("decks", "level_order")
    op.drop_column("decks", "level")
