"""session deck set null

Revision ID: 274638158d3e
Revises: c86ee931bb28
Create Date: 2026-10-29 22:01:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "274638158d3e"
down_revision: str | Sequence[str] | None = "c86ee931bb28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0019: a deleted deck leaves its finished lessons as history, without a deck.
    op.alter_column(
        "learning_sessions", "deck_id", existing_type=sa.String(length=64), nullable=True
    )
    op.drop_constraint(
        op.f("fk_learning_sessions_deck_id_decks"), "learning_sessions", type_="foreignkey"
    )
    op.create_foreign_key(
        op.f("fk_learning_sessions_deck_id_decks"),
        "learning_sessions",
        "decks",
        ["deck_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Lessons of decks deleted since can't name a deck again: they go, with their answers.
    op.execute("DELETE FROM learning_sessions WHERE deck_id IS NULL")
    op.drop_constraint(
        op.f("fk_learning_sessions_deck_id_decks"), "learning_sessions", type_="foreignkey"
    )
    op.create_foreign_key(
        op.f("fk_learning_sessions_deck_id_decks"),
        "learning_sessions",
        "decks",
        ["deck_id"],
        ["id"],
    )
    op.alter_column(
        "learning_sessions", "deck_id", existing_type=sa.String(length=64), nullable=False
    )
