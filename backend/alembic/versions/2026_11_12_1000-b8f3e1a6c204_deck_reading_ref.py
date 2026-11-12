"""deck reading ref: a user deck made from a reading, listed apart on home («Из чтения»)

Revision ID: b8f3e1a6c204
Revises: c7e2a9d4b381
Create Date: 2026-11-12 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8f3e1a6c204"
down_revision: str | Sequence[str] | None = "c7e2a9d4b381"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable and unread by the running version: deploying it first breaks nothing.
    op.add_column("decks", sa.Column("reading_ref", sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.drop_column("decks", "reading_ref")
