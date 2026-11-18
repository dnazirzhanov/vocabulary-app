"""speaking v1: session + audio asset tables for Chunk 2 (upload flow, no AI yet)

Revision ID: f5c7a3b9d804
Revises: e4a8b2c7d913
Create Date: 2026-11-16 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f5c7a3b9d804"
down_revision: str | Sequence[str] | None = "e4a8b2c7d913"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "speaking_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_type", sa.String(length=16), nullable=False),
        sa.Column("question_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="created"),
        sa.Column("failure_reason", sa.String(length=64), nullable=True),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "exercise_type IN ('spontaneous', 'pronunciation')",
            name=op.f("ck_speaking_sessions_exercise_type"),
        ),
        sa.CheckConstraint(
            "status IN ('created', 'uploaded', 'processing', 'done', 'failed')",
            name=op.f("ck_speaking_sessions_status"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_speaking_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_speaking_sessions")),
    )
    op.create_index(
        op.f("ix_speaking_sessions_user_id"),
        "speaking_sessions",
        ["user_id", sa.text("started_at DESC")],
    )
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE speaking_sessions ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "speaking_audio_assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("storage_mode", sa.String(length=16), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("sample_rate", sa.Integer(), nullable=True),
        sa.Column(
            "uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "byte_size >= 0 AND byte_size <= 20971520",
            name=op.f("ck_speaking_audio_assets_size"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["speaking_sessions.id"],
            name=op.f("fk_speaking_audio_assets_session_id_speaking_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_speaking_audio_assets")),
    )
    op.create_index(
        op.f("ix_speaking_audio_assets_session_id"),
        "speaking_audio_assets",
        ["session_id"],
    )
    # Index for the cleanup worker (Chunk 9) that drops expired or soft-deleted assets.
    op.create_index(
        op.f("ix_speaking_audio_assets_expires"),
        "speaking_audio_assets",
        ["expires_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.execute("ALTER TABLE speaking_audio_assets ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("speaking_audio_assets")
    op.drop_table("speaking_sessions")
