"""reports of bad wording in the app's text (ADR 0055)

Revision ID: f3b8d5e0a241
Revises: e2a7c4d9b130
Create Date: 2026-11-06 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3b8d5e0a241"
down_revision: str | Sequence[str] | None = "e2a7c4d9b130"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wording_reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("ui_language", sa.String(length=2), nullable=True),
        sa.Column("text", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wording_reports_user_id", "wording_reports", ["user_id"])


def downgrade() -> None:
    op.drop_table("wording_reports")
