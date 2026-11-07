"""the app's language on each account (ADR 0055)

Revision ID: e2a7c4d9b130
Revises: d1f9a6c3e872
Create Date: 2026-11-06 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2a7c4d9b130"
down_revision: str | Sequence[str] | None = "d1f9a6c3e872"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ui_language", sa.String(length=2), nullable=True))
    # Everyone so far has been using it in Russian.
    op.execute("UPDATE users SET ui_language = 'ru'")


def downgrade() -> None:
    op.drop_column("users", "ui_language")
