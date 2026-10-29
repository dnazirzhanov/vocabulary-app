"""teacher decks

Revision ID: bcd6beeef1ce
Revises: 7c2f9a4e6b11
Create Date: 2026-10-29 11:54:56

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bcd6beeef1ce"
down_revision: str | Sequence[str] | None = "7c2f9a4e6b11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0017: decks a teacher writes and gives to a group; existing decks are the course.
    op.add_column(
        "decks",
        sa.Column("kind", sa.String(length=8), server_default=sa.text("'course'"), nullable=False),
    )
    op.create_check_constraint("kind_values", "decks", "kind IN ('course', 'group')")
    op.add_column("decks", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.add_column(
        "decks",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(op.f("ix_decks_owner_id"), "decks", ["owner_id"])
    op.create_foreign_key(
        op.f("fk_decks_owner_id_users"), "decks", "users", ["owner_id"], ["id"], ondelete="SET NULL"
    )
    op.add_column("words", sa.Column("owner_deck_id", sa.String(length=64), nullable=True))
    op.create_index(op.f("ix_words_owner_deck_id"), "words", ["owner_deck_id"])
    op.create_foreign_key(
        op.f("fk_words_owner_deck_id_decks"),
        "words",
        "decks",
        ["owner_deck_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_table(
        "deck_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("deck_id", sa.String(length=64), nullable=False),
        sa.Column("assigned_by", sa.Uuid(), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_by"],
            ["users.id"],
            name=op.f("fk_deck_assignments_assigned_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["deck_id"],
            ["decks.id"],
            name=op.f("fk_deck_assignments_deck_id_decks"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name=op.f("fk_deck_assignments_group_id_groups"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_deck_assignments")),
        sa.UniqueConstraint(
            "group_id", "deck_id", name=op.f("uq_deck_assignments_group_id_deck_id")
        ),
    )
    op.create_index(op.f("ix_deck_assignments_deck_id"), "deck_assignments", ["deck_id"])


def downgrade() -> None:
    # Group decks and everything learned from their own words go with them.
    group_words = "SELECT id FROM words WHERE owner_deck_id IS NOT NULL"
    group_decks = "SELECT id FROM decks WHERE kind = 'group'"
    op.execute(f"DELETE FROM review_attempts WHERE word_id IN ({group_words})")  # noqa: S608
    op.execute(f"DELETE FROM user_word_progress WHERE word_id IN ({group_words})")  # noqa: S608
    op.execute(f"DELETE FROM learning_sessions WHERE deck_id IN ({group_decks})")  # noqa: S608
    op.drop_index(op.f("ix_deck_assignments_deck_id"), table_name="deck_assignments")
    op.drop_table("deck_assignments")
    op.execute("DELETE FROM decks WHERE kind = 'group'")
    op.drop_constraint(op.f("fk_words_owner_deck_id_decks"), "words", type_="foreignkey")
    op.drop_index(op.f("ix_words_owner_deck_id"), table_name="words")
    op.drop_column("words", "owner_deck_id")
    op.drop_constraint(op.f("fk_decks_owner_id_users"), "decks", type_="foreignkey")
    op.drop_index(op.f("ix_decks_owner_id"), table_name="decks")
    op.drop_column("decks", "created_at")
    op.drop_column("decks", "owner_id")
    op.drop_constraint(op.f("ck_decks_kind_values"), "decks", type_="check")
    op.drop_column("decks", "kind")
