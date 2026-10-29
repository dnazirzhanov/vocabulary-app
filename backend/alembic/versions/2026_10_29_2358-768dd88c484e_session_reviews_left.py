"""session reviews left

Revision ID: 768dd88c484e
Revises: 7b0678a8d6bd
Create Date: 2026-10-29 23:58:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "768dd88c484e"
down_revision: str | Sequence[str] | None = "7b0678a8d6bd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0022: a day is kept with every due review done; a finished study session records what
    # it left. Earlier sessions stay null and count as done.
    op.add_column("learning_sessions", sa.Column("reviews_left", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("learning_sessions", "reviews_left")
