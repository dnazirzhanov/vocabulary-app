"""a YouTube video's captions, fetched once for everyone (ADR 0100)

Revision ID: f6a8b0c2d457
Revises: e5f7a9b1c346
Create Date: 2026-11-27 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f6a8b0c2d457"
down_revision: str | Sequence[str] | None = "e5f7a9b1c346"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A new table: the running version never reads it.
    op.create_table(
        "youtube_transcripts",
        sa.Column("youtube_id", sa.String(length=16), primary_key=True),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("cues", postgresql.JSONB(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute("ALTER TABLE youtube_transcripts ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("youtube_transcripts")
