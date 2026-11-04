"""a morning reminder, and which notifications a learner wants (ADR 0042)

Revision ID: f2c6a1d83b94
Revises: d4a8f6b21c07
Create Date: 2026-11-04 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2c6a1d83b94"
down_revision: str | Sequence[str] | None = "d4a8f6b21c07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHOICES = ("notify_morning", "notify_afternoon", "notify_report", "notify_deadline")


def upgrade() -> None:
    op.add_column("push_subscriptions", sa.Column("last_morning_on", sa.Date(), nullable=True))
    for choice in CHOICES:
        op.add_column(
            "users",
            sa.Column(choice, sa.Boolean(), server_default=sa.text("true"), nullable=False),
        )


def downgrade() -> None:
    for choice in CHOICES:
        op.drop_column("users", choice)
    op.drop_column("push_subscriptions", "last_morning_on")
