"""deck seen words

Revision ID: c41bd26fc30e
Revises: 274638158d3e
Create Date: 2026-10-29 23:04:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c41bd26fc30e"
down_revision: str | Sequence[str] | None = "274638158d3e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _key(headword: str) -> str:
    """generation.word_key as of this migration (kept here, so later changes can't alter it)."""
    words = " ".join(headword.lower().replace("-", " ").split()).split(" ")
    last = words[-1]
    if len(last) > 4 and last.endswith("ies"):
        last = last[:-3] + "y"
    elif len(last) > 4 and last.endswith(("ses", "xes", "zes", "ches", "shes")):
        last = last[:-2]
    elif len(last) > 3 and last.endswith("s") and not last.endswith(("ss", "us", "is")):
        last = last[:-1]
    return " ".join([*words[:-1], last])


def upgrade() -> None:
    # ADR 0019: every word a user deck has had, so the AI never brings it the same word again.
    table = op.create_table(
        "deck_seen_words",
        sa.Column("deck_id", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("headword", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["deck_id"],
            ["decks.id"],
            name=op.f("fk_deck_seen_words_deck_id_decks"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("deck_id", "key", name=op.f("pk_deck_seen_words")),
    )
    rows = op.get_bind().execute(
        sa.text(
            "SELECT dw.deck_id, w.headword FROM deck_words dw"
            " JOIN words w ON w.id = dw.word_id JOIN decks d ON d.id = dw.deck_id"
            " WHERE d.kind = 'user' ORDER BY dw.deck_id, dw.position"
        )
    )
    seen: dict[tuple[str, str], str] = {}
    for deck_id, headword in rows:
        seen.setdefault((deck_id, _key(headword)), headword)
    if seen:
        op.bulk_insert(
            table,
            [{"deck_id": d, "key": k, "headword": h} for (d, k), h in seen.items()],
        )


def downgrade() -> None:
    op.drop_table("deck_seen_words")
