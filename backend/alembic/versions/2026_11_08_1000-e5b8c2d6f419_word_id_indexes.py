"""indexes on the word of progress, spelling, answers and deck links (performance, Nov 2026)

Each of these tables points at `words` without an index on that column, so deleting or editing a
word or a deck read the whole of the largest tables to find its rows.

Revision ID: e5b8c2d6f419
Revises: d1a4b7c9e203
Create Date: 2026-11-08 10:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "e5b8c2d6f419"
down_revision: str | Sequence[str] | None = "d1a4b7c9e203"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXED = ("user_word_progress", "spelling_progress", "review_attempts", "deck_words")


def upgrade() -> None:
    for table in INDEXED:
        op.create_index(op.f(f"ix_{table}_word_id"), table, ["word_id"])


def downgrade() -> None:
    for table in INDEXED:
        op.drop_index(op.f(f"ix_{table}_word_id"), table_name=table)
