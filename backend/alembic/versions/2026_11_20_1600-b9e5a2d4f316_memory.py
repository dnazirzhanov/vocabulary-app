"""memory: what the mentor knows about a learner, what happened, chat summaries (ADR 0075)

Revision ID: b9e5a2d4f316
Revises: a7d3f1c9e215
Create Date: 2026-11-20 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b9e5a2d4f316"
down_revision: str | Sequence[str] | None = "a7d3f1c9e215"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = "'why', 'likes', 'dislikes', 'constraint', 'energy', 'word', 'other'"


def upgrade() -> None:
    op.create_table(
        "learner_facts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("text", sa.String(length=200), nullable=False),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"kind IN ({KINDS})", name="ck_learner_facts_kind"),
        sa.CheckConstraint("source IN ('chat', 'user', 'coach')", name="ck_learner_facts_source"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learner_facts_user_id", "learner_facts", ["user_id"])
    op.execute("ALTER TABLE learner_facts ENABLE ROW LEVEL SECURITY")
    op.create_table(
        "mentor_timeline",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("note", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mentor_timeline_user_at", "mentor_timeline", ["user_id", "at"])
    op.execute("ALTER TABLE mentor_timeline ENABLE ROW LEVEL SECURITY")
    op.add_column("mentor_conversations", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column(
        "mentor_conversations", sa.Column("summarized_messages", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("mentor_conversations", "summarized_messages")
    op.drop_column("mentor_conversations", "summary")
    op.drop_index("ix_mentor_timeline_user_at", table_name="mentor_timeline")
    op.drop_table("mentor_timeline")
    op.drop_index("ix_learner_facts_user_id", table_name="learner_facts")
    op.drop_table("learner_facts")
