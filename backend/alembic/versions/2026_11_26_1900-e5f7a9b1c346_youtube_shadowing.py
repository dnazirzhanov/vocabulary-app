"""shadowing exercises from a YouTube video (ADR 0097)

Revision ID: e5f7a9b1c346
Revises: d4e6f8a0b235
Create Date: 2026-11-26 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f7a9b1c346"
down_revision: str | Sequence[str] | None = "d4e6f8a0b235"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Defaulted or nullable: the running version neither reads nor writes them.
    op.add_column(
        "shadowing_exercises",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="file"),
    )
    op.add_column("shadowing_exercises", sa.Column("youtube_id", sa.String(length=16)))
    op.add_column("shadowing_exercises", sa.Column("clip_start_ms", sa.Integer()))
    op.add_column("shadowing_exercises", sa.Column("clip_end_ms", sa.Integer()))
    op.add_column("shadowing_exercises", sa.Column("thumbnail_url", sa.Text()))
    op.add_column(
        "shadowing_exercises",
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_shadowing_exercises_created_by", "shadowing_exercises", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_shadowing_exercises_created_by", table_name="shadowing_exercises")
    op.drop_column("shadowing_exercises", "created_by")
    op.drop_column("shadowing_exercises", "thumbnail_url")
    op.drop_column("shadowing_exercises", "clip_end_ms")
    op.drop_column("shadowing_exercises", "clip_start_ms")
    op.drop_column("shadowing_exercises", "youtube_id")
    op.drop_column("shadowing_exercises", "source")
