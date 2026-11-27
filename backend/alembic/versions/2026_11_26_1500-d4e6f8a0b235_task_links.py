"""task links: a group task's material (ADR 0096)

Revision ID: d4e6f8a0b235
Revises: c3d5e7f9a124
Create Date: 2026-11-26 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e6f8a0b235"
down_revision: str | Sequence[str] | None = "c3d5e7f9a124"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable: the running version neither reads nor writes them.
    op.add_column("tasks", sa.Column("link_kind", sa.String(length=16), nullable=True))
    op.add_column("tasks", sa.Column("link_ref", sa.String(length=80), nullable=True))
    op.add_column("tasks", sa.Column("link_title", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "link_title")
    op.drop_column("tasks", "link_ref")
    op.drop_column("tasks", "link_kind")
