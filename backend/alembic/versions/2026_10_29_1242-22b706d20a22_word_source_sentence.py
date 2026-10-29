"""word source sentence

Revision ID: 22b706d20a22
Revises: bcd6beeef1ce
Create Date: 2026-10-29 12:42:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "22b706d20a22"
down_revision: str | Sequence[str] | None = "bcd6beeef1ce"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0018: the sentence of the teacher's material a drafted word came from.
    op.add_column("words", sa.Column("source_sentence", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("words", "source_sentence")
