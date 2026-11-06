"""each opening of a group test gives everyone one attempt (ADR 0048)

Revision ID: d1f9a6c3e872
Revises: c8e4b7a2d610
Create Date: 2026-11-05 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1f9a6c3e872"
down_revision: str | Sequence[str] | None = "c8e4b7a2d610"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "group_tests",
        sa.Column("opening", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "test_attempts",
        sa.Column("opening", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
    )
    # What exists belongs to a first opening.
    op.execute(
        "UPDATE group_tests SET opening = 1 WHERE is_open OR EXISTS"
        " (SELECT 1 FROM test_attempts WHERE test_attempts.test_id = group_tests.id"
        " AND test_attempts.kind = 'test')"
    )
    op.execute("UPDATE test_attempts SET opening = 1 WHERE kind = 'test'")
    op.drop_index(
        "uq_test_attempts_one_test",
        table_name="test_attempts",
        postgresql_where=sa.text("kind = 'test'"),
    )
    op.drop_index(
        "uq_test_attempts_one_open_practice",
        table_name="test_attempts",
        postgresql_where=sa.text("kind = 'practice' AND finished_at IS NULL"),
    )
    op.create_index(
        "uq_test_attempts_one_per_opening",
        "test_attempts",
        ["test_id", "member_id", "opening"],
        unique=True,
        postgresql_where=sa.text("kind = 'test'"),
    )
    op.create_index(
        "uq_test_attempts_one_running",
        "test_attempts",
        ["test_id", "member_id", "kind"],
        unique=True,
        postgresql_where=sa.text("finished_at IS NULL"),
    )


def downgrade() -> None:
    # Only the latest attempt of each member fits the old rule of one test per member.
    op.execute(
        "DELETE FROM test_attempts a USING test_attempts b WHERE a.kind = 'test'"
        " AND b.kind = 'test' AND a.test_id = b.test_id AND a.member_id = b.member_id"
        " AND a.started_at < b.started_at"
    )
    op.drop_index(
        "uq_test_attempts_one_running",
        table_name="test_attempts",
        postgresql_where=sa.text("finished_at IS NULL"),
    )
    op.drop_index(
        "uq_test_attempts_one_per_opening",
        table_name="test_attempts",
        postgresql_where=sa.text("kind = 'test'"),
    )
    op.create_index(
        "uq_test_attempts_one_open_practice",
        "test_attempts",
        ["test_id", "member_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'practice' AND finished_at IS NULL"),
    )
    op.create_index(
        "uq_test_attempts_one_test",
        "test_attempts",
        ["test_id", "member_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'test'"),
    )
    op.drop_column("test_attempts", "opening")
    op.drop_column("group_tests", "opening")
