"""learning loop tables

Revision ID: 1b2cc1422266
Revises:
Create Date: 2026-10-25 20:45:29.651873

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "1b2cc1422266"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "decks",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("learning_language", sa.String(length=8), nullable=False),
        sa.Column("explanation_language", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("content_version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_decks")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("auth_subject", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("auth_subject", name=op.f("uq_users_auth_subject")),
    )
    op.create_table(
        "words",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("headword", sa.String(length=64), nullable=False),
        sa.Column("pos", sa.String(length=16), nullable=False),
        sa.Column("translation", sa.String(length=120), nullable=False),
        sa.Column("also_accept", sa.ARRAY(sa.String(length=64)), nullable=False),
        sa.Column("example", sa.Text(), nullable=False),
        sa.Column("example_ru", sa.Text(), nullable=False),
        sa.Column("illustration", sa.String(length=32), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_words")),
    )
    op.create_table(
        "deck_words",
        sa.Column("deck_id", sa.String(length=64), nullable=False),
        sa.Column("word_id", sa.String(length=64), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["deck_id"], ["decks.id"], name=op.f("fk_deck_words_deck_id_decks"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["word_id"], ["words.id"], name=op.f("fk_deck_words_word_id_words")
        ),
        sa.PrimaryKeyConstraint("deck_id", "word_id", name=op.f("pk_deck_words")),
        sa.UniqueConstraint("deck_id", "position", name=op.f("uq_deck_words_deck_id_position")),
    )
    op.create_table(
        "learning_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("deck_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('new', 'practice')", name=op.f("ck_learning_sessions_kind")),
        sa.ForeignKeyConstraint(
            ["deck_id"], ["decks.id"], name=op.f("fk_learning_sessions_deck_id_decks")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_learning_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_learning_sessions")),
    )
    op.create_index(
        "uq_learning_sessions_open_per_user",
        "learning_sessions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("completed_at IS NULL"),
    )
    op.create_table(
        "user_word_progress",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("word_id", sa.String(length=64), nullable=False),
        sa.Column("introduced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("correct_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("incorrect_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_word_progress_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["word_id"], ["words.id"], name=op.f("fk_user_word_progress_word_id_words")
        ),
        sa.PrimaryKeyConstraint("user_id", "word_id", name=op.f("pk_user_word_progress")),
    )
    op.create_table(
        "review_attempts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("word_id", sa.String(length=64), nullable=False),
        sa.Column("exercise_id", sa.String(length=8), nullable=False),
        sa.Column("exercise_type", sa.String(length=24), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(exercise_type = 'introduce') = (correct IS NULL)",
            name=op.f("ck_review_attempts_correct_only_for_answers"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["learning_sessions.id"],
            name=op.f("fk_review_attempts_session_id_learning_sessions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_review_attempts_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["word_id"], ["words.id"], name=op.f("fk_review_attempts_word_id_words")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_attempts")),
        sa.UniqueConstraint(
            "session_id", "exercise_id", name=op.f("uq_review_attempts_session_id_exercise_id")
        ),
    )
    op.create_index(
        "ix_review_attempts_user_answered",
        "review_attempts",
        ["user_id", "answered_at"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_review_attempts_user_answered", table_name="review_attempts")
    op.drop_table("review_attempts")
    op.drop_table("user_word_progress")
    op.drop_index(
        "uq_learning_sessions_open_per_user",
        table_name="learning_sessions",
        postgresql_where=sa.text("completed_at IS NULL"),
    )
    op.drop_table("learning_sessions")
    op.drop_table("deck_words")
    op.drop_table("words")
    op.drop_table("users")
    op.drop_table("decks")
