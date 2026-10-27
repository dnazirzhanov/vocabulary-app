"""spelling

Revision ID: 7c2f9a4e6b11
Revises: 5b7e1d9c3a20
Create Date: 2026-10-28 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c2f9a4e6b11"
down_revision: str | Sequence[str] | None = "5b7e1d9c3a20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0016: spelling answers (exercise types spell_guided / spell_recall) fit the attempts
    # table as it is; they add whether the word was shown, and a schedule of their own.
    op.add_column(
        "review_attempts",
        sa.Column("hint_used", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "learning_sessions", sa.Column("spelling_words", sa.SmallInteger(), nullable=True)
    )
    op.create_table(
        "user_word_spelling",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("word_id", sa.String(length=64), nullable=False),
        sa.Column("stage", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_word_spelling_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["word_id"], ["words.id"], name=op.f("fk_user_word_spelling_word_id_words")
        ),
        sa.PrimaryKeyConstraint("user_id", "word_id", name=op.f("pk_user_word_spelling")),
    )


def downgrade() -> None:
    op.drop_table("user_word_spelling")
    op.drop_column("learning_sessions", "spelling_words")
    op.drop_column("review_attempts", "hint_used")
