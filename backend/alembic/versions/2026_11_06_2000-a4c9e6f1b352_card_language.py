"""the language a learner studies in, and an example's translation named for what it is (ADR 0055)

Revision ID: a4c9e6f1b352
Revises: f3b8d5e0a241
Create Date: 2026-11-06 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4c9e6f1b352"
down_revision: str | Sequence[str] | None = "f3b8d5e0a241"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("language", sa.String(length=2), nullable=True))
    # Everyone so far has been studying in Russian.
    op.execute("UPDATE users SET language = 'ru'")
    op.alter_column("words", "example_ru", new_column_name="example_translation")


def downgrade() -> None:
    op.alter_column("words", "example_translation", new_column_name="example_ru")
    op.drop_column("users", "language")
