"""a YouTube video's speech recognition words beside the channel's own lines (ADR 0100)

Revision ID: a7b9c1d3e568
Revises: f6a8b0c2d457
Create Date: 2026-11-27 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7b9c1d3e568"
down_revision: str | Sequence[str] | None = "f6a8b0c2d457"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable: the running version neither reads nor writes it.
    op.add_column("youtube_transcripts", sa.Column("words", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("youtube_transcripts", "words")
