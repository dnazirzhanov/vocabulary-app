"""reading questions and answers: comprehension questions on own texts, and readers' answers

Revision ID: d9e2b5c8a147
Revises: c4a7d2e9f513
Create Date: 2026-11-12 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9e2b5c8a147"
down_revision: str | Sequence[str] | None = "c4a7d2e9f513"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reading_questions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reading_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("min_words", sa.SmallInteger(), nullable=False),
        sa.Column("max_words", sa.SmallInteger(), nullable=False),
        sa.CheckConstraint(
            "min_words >= 1 AND min_words <= max_words AND max_words <= 500",
            name=op.f("ck_reading_questions_limits"),
        ),
        sa.ForeignKeyConstraint(
            ["reading_id"],
            ["readings.id"],
            name=op.f("fk_reading_questions_reading_id_readings"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reading_questions")),
    )
    op.create_index(op.f("ix_reading_questions_reading_id"), "reading_questions", ["reading_id"])
    op.create_table(
        "reading_answers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("question_ref", sa.String(length=80), nullable=False),
        sa.Column("reading_ref", sa.String(length=80), nullable=False),
        sa.Column("question_text", sa.String(length=300), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("words", sa.SmallInteger(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_reading_answers_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reading_answers")),
        sa.UniqueConstraint(
            "user_id", "question_ref", name=op.f("uq_reading_answers_user_id_question_ref")
        ),
    )
    op.create_index(
        "ix_reading_answers_user_reading", "reading_answers", ["user_id", "reading_ref"]
    )
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE reading_questions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE reading_answers ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("reading_answers")
    op.drop_table("reading_questions")
