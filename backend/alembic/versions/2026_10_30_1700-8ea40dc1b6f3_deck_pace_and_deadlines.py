"""deck pace and deadlines (ADR 0028)

Revision ID: 8ea40dc1b6f3
Revises: 9a3c4d2e7f10
Create Date: 2026-10-30 15:05:25.818684

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8ea40dc1b6f3"
down_revision: str | Sequence[str] | None = "9a3c4d2e7f10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deck_paces",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("deck_id", sa.String(length=64), nullable=False),
        sa.Column("daily_new", sa.SmallInteger(), nullable=True),
        sa.Column("extra_day", sa.Date(), nullable=True),
        sa.Column("extra_words", sa.SmallInteger(), nullable=True),
        sa.CheckConstraint(
            "daily_new BETWEEN 1 AND 100", name=op.f("ck_deck_paces_daily_new_range")
        ),
        sa.CheckConstraint(
            "extra_words BETWEEN 1 AND 200", name=op.f("ck_deck_paces_extra_words_range")
        ),
        sa.ForeignKeyConstraint(
            ["deck_id"], ["decks.id"], name=op.f("fk_deck_paces_deck_id_decks"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_deck_paces_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "deck_id", name=op.f("pk_deck_paces")),
    )
    op.add_column("deck_assignments", sa.Column("due_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("deck_assignments", "due_on")
    op.drop_table("deck_paces")
