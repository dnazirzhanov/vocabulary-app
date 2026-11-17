"""speaking: job queue + assessment tables (Chunk 3 — transcription pipeline)

Revision ID: a6d4c8f2e391
Revises: f5c7a3b9d804
Create Date: 2026-11-17 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a6d4c8f2e391"
down_revision: str | Sequence[str] | None = "f5c7a3b9d804"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "speaking_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by", sa.String(length=128), nullable=True),
        sa.Column(
            "not_before",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "kind IN ('assess', 'cleanup_audio')",
            name=op.f("ck_speaking_jobs_kind"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'claimed', 'done', 'failed')",
            name=op.f("ck_speaking_jobs_status"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["speaking_sessions.id"],
            name=op.f("fk_speaking_jobs_session_id_speaking_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_speaking_jobs")),
        # One assess job per session: prevents double-enqueue on retried finalize requests.
        sa.UniqueConstraint("session_id", "kind", name=op.f("uq_speaking_jobs_session_id_kind")),
    )
    op.create_index(
        op.f("ix_speaking_jobs_claim"),
        "speaking_jobs",
        ["status", "not_before"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.execute("ALTER TABLE speaking_jobs ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "speaking_assessments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("audio_asset_id", sa.Uuid(), nullable=False),
        # Bumped in a future migration when scoring logic changes materially (re-score old sessions).
        sa.Column("assessment_version", sa.Integer(), nullable=False, server_default="1"),
        # Raw transcript — NEVER corrected; corrections stored in feedback_items.
        sa.Column("transcript", sa.Text(), nullable=False),
        # [{word, start_ms, end_ms, confidence}] from Whisper verbose_json.
        sa.Column("transcript_words", sa.JSON(), nullable=False),
        # All score columns are nullable: null = "not enough evidence to score this dimension".
        sa.Column("pronunciation_score", sa.Float(), nullable=True),
        sa.Column("fluency_score", sa.Float(), nullable=True),
        sa.Column("vocabulary_score", sa.Float(), nullable=True),
        sa.Column("grammar_score", sa.Float(), nullable=True),
        sa.Column("coherence_score", sa.Float(), nullable=True),
        sa.Column("overall_score", sa.Float(), nullable=True),
        # Raw provider outputs — Chunk 3 has only whisper data; later chunks add azure/lt/deepseek.
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["audio_asset_id"],
            ["speaking_audio_assets.id"],
            name=op.f("fk_speaking_assessments_audio_asset_id_speaking_audio_assets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["speaking_sessions.id"],
            name=op.f("fk_speaking_assessments_session_id_speaking_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_speaking_assessments")),
    )
    op.create_index(
        op.f("ix_speaking_assessments_session_id"),
        "speaking_assessments",
        ["session_id"],
    )
    op.execute("ALTER TABLE speaking_assessments ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "speaking_feedback_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("assessment_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("original_text", sa.Text(), nullable=True),
        sa.Column("corrected_text", sa.Text(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("evidence_ref", sa.JSON(), nullable=True),
        sa.CheckConstraint(
            "category IN ('pronunciation','grammar','vocabulary','coherence','fluency')",
            name=op.f("ck_speaking_feedback_items_category"),
        ),
        sa.CheckConstraint(
            "severity IN ('info','minor','major')",
            name=op.f("ck_speaking_feedback_items_severity"),
        ),
        sa.ForeignKeyConstraint(
            ["assessment_id"],
            ["speaking_assessments.id"],
            name=op.f("fk_speaking_feedback_items_assessment_id_speaking_assessments"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_speaking_feedback_items")),
    )
    op.create_index(
        op.f("ix_speaking_feedback_items_assessment_id"),
        "speaking_feedback_items",
        ["assessment_id"],
    )
    op.execute("ALTER TABLE speaking_feedback_items ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("speaking_feedback_items")
    op.drop_table("speaking_assessments")
    op.drop_table("speaking_jobs")
