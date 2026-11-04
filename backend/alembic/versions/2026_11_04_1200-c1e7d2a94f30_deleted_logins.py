"""deleted logins (ADR 0043)

Revision ID: c1e7d2a94f30
Revises: b6613ef67888
Create Date: 2026-11-04 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1e7d2a94f30"
down_revision: str | Sequence[str] | None = "b6613ef67888"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deleted_logins",
        sa.Column("auth_subject", sa.String(length=255), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("auth_subject", name=op.f("pk_deleted_logins")),
    )


def downgrade() -> None:
    op.drop_table("deleted_logins")
