"""each word says what its translation is written in, chosen as cards are made (ADR 0055)

Revision ID: b5d0f7a2c463
Revises: a4c9e6f1b352
Create Date: 2026-11-07 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b5d0f7a2c463"
down_revision: str | Sequence[str] | None = "a4c9e6f1b352"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "words",
        sa.Column("language", sa.String(length=2), server_default=sa.text("'ru'"), nullable=False),
    )
    op.execute(
        """
        UPDATE words SET language = decks.explanation_language
        FROM decks WHERE words.owner_deck_id = decks.id
        """
    )


def downgrade() -> None:
    op.drop_column("words", "language")
