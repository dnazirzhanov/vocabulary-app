"""shadowing: exercises and attempts tables

Revision ID: b7e5d1c3a209
Revises: ede306b59d64
Create Date: 2026-11-18 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7e5d1c3a209"
down_revision: str | Sequence[str] | None = "ede306b59d64"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shadowing_exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=256), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("difficulty", sa.String(length=16), nullable=False),
        sa.Column("language", sa.String(length=8), nullable=False, server_default="en"),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("transcript", sa.Text(), nullable=False),
        sa.Column("sentences", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("speaker", sa.String(length=128), nullable=True),
        sa.Column("audio_path", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "audio_mime_type", sa.String(length=64), nullable=False, server_default="audio/webm"
        ),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shadowing_exercises")),
        sa.UniqueConstraint("slug", name=op.f("uq_shadowing_exercises_slug")),
        sa.CheckConstraint(
            "difficulty IN ('beginner', 'intermediate', 'advanced')",
            name=op.f("ck_shadowing_exercises_difficulty"),
        ),
    )
    op.create_table(
        "shadowing_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=False),
        sa.Column("audio_path", sa.Text(), nullable=True),
        sa.Column("audio_mime_type", sa.String(length=64), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["exercise_id"],
            ["shadowing_exercises.id"],
            name=op.f("fk_shadowing_attempts_exercise_id_shadowing_exercises"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_shadowing_attempts_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shadowing_attempts")),
    )
    op.create_index(
        op.f("ix_shadowing_attempts_user_id"), "shadowing_attempts", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_shadowing_attempts_exercise_id"),
        "shadowing_attempts",
        ["exercise_id"],
        unique=False,
    )

    op.execute("ALTER TABLE shadowing_exercises ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE shadowing_attempts ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index(op.f("ix_shadowing_attempts_exercise_id"), table_name="shadowing_attempts")
    op.drop_index(op.f("ix_shadowing_attempts_user_id"), table_name="shadowing_attempts")
    op.drop_table("shadowing_attempts")
    op.drop_table("shadowing_exercises")
