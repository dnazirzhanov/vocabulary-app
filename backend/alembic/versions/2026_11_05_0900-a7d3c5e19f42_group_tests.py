"""spelling tests of a group's decks: the test, its attempts and their questions (ADR 0046)

Revision ID: a7d3c5e19f42
Revises: f2c6a1d83b94
Create Date: 2026-11-05 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7d3c5e19f42"
down_revision: str | Sequence[str] | None = "f2c6a1d83b94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "group_tests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("assignment_id", sa.Uuid(), nullable=False),
        sa.Column("word_ids", postgresql.JSONB(), nullable=False),
        sa.Column("excluded_word_ids", postgresql.JSONB(), nullable=False),
        sa.Column("question_count", sa.SmallInteger(), nullable=True),
        sa.Column("pass_percent", sa.SmallInteger(), nullable=False),
        sa.Column("minutes", sa.SmallInteger(), nullable=False),
        sa.Column("is_open", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(
            "pass_percent BETWEEN 1 AND 100", name=op.f("ck_group_tests_pass_percent_range")
        ),
        sa.CheckConstraint("minutes BETWEEN 1 AND 180", name=op.f("ck_group_tests_minutes_range")),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["deck_assignments.id"],
            name=op.f("fk_group_tests_assignment_id_deck_assignments"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_group_tests")),
        sa.UniqueConstraint("assignment_id", name=op.f("uq_group_tests_assignment_id")),
    )
    op.create_table(
        "test_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("test_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("correct", sa.SmallInteger(), nullable=True),
        sa.Column("total", sa.SmallInteger(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('test', 'practice')", name=op.f("ck_test_attempts_kind_values")
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["group_members.id"],
            name=op.f("fk_test_attempts_member_id_group_members"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["test_id"],
            ["group_tests.id"],
            name=op.f("fk_test_attempts_test_id_group_tests"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_test_attempts")),
    )
    op.create_index(
        "uq_test_attempts_one_test",
        "test_attempts",
        ["test_id", "member_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'test'"),
    )
    op.create_index(
        "uq_test_attempts_one_open_practice",
        "test_attempts",
        ["test_id", "member_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'practice' AND finished_at IS NULL"),
    )
    op.create_index("ix_test_attempts_member_id", "test_attempts", ["member_id"])
    op.create_index("ix_test_attempts_started_at", "test_attempts", ["started_at"])
    op.create_table(
        "test_questions",
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=12), nullable=False),
        sa.Column("word_id", sa.String(length=64), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("headword", sa.String(length=64), nullable=False),
        sa.Column("translation", sa.String(length=120), nullable=False),
        sa.Column("pos", sa.String(length=16), nullable=False),
        sa.Column("answer", sa.String(length=80), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["test_attempts.id"],
            name=op.f("fk_test_questions_attempt_id_test_attempts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("attempt_id", "word_id", name=op.f("pk_test_questions")),
    )


def downgrade() -> None:
    op.drop_table("test_questions")
    op.drop_index("ix_test_attempts_started_at", table_name="test_attempts")
    op.drop_index("ix_test_attempts_member_id", table_name="test_attempts")
    op.drop_index(
        "uq_test_attempts_one_open_practice",
        table_name="test_attempts",
        postgresql_where=sa.text("kind = 'practice' AND finished_at IS NULL"),
    )
    op.drop_index(
        "uq_test_attempts_one_test",
        table_name="test_attempts",
        postgresql_where=sa.text("kind = 'test'"),
    )
    op.drop_table("test_attempts")
    op.drop_table("group_tests")
