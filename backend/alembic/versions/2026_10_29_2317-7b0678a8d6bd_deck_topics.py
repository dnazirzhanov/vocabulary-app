"""deck topics

Revision ID: 7b0678a8d6bd
Revises: c41bd26fc30e
Create Date: 2026-10-29 23:17:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7b0678a8d6bd"
down_revision: str | Sequence[str] | None = "c41bd26fc30e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0019: the topics a deck has been grown with; the editor offers the last one again.
    op.create_table(
        "deck_topics",
        sa.Column("deck_id", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("topic", sa.String(length=80), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["deck_id"], ["decks.id"], name=op.f("fk_deck_topics_deck_id_decks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("deck_id", "key", name=op.f("pk_deck_topics")),
    )


def downgrade() -> None:
    op.drop_table("deck_topics")
