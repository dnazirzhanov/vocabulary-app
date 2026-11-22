"""pronunciation: audio made once by the server's voice

Revision ID: d1a7c3e5f902
Revises: c8f6e2d4b310
Create Date: 2026-11-19 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1a7c3e5f902"
down_revision: str | Sequence[str] | None = "c8f6e2d4b310"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pronunciation_audio",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("voice", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("storage_path", sa.String(length=255), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("key"),
    )
    op.execute("ALTER TABLE pronunciation_audio ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("pronunciation_audio")
