"""reading topic: a text of one's own filed under one of the library's topics

Revision ID: a5c9e2f7b318
Revises: f3b8d1a6e924
Create Date: 2026-11-13 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a5c9e2f7b318"
down_revision: str | Sequence[str] | None = "f3b8d1a6e924"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable and unread by the running version: deploying it first breaks nothing.
    op.add_column("readings", sa.Column("topic", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("readings", "topic")
