"""mentor: conversations, and tool calls kept with messages (ADR 0072)

Existing messages become each learner's first conversation, titled from its first question.

Revision ID: f5c3e7b9d124
Revises: e4b2d6a8c013
Create Date: 2026-11-20 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f5c3e7b9d124"
down_revision: str | Sequence[str] | None = "e4b2d6a8c013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mentor_conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_mentor_conversations_user_updated", "mentor_conversations", ["user_id", "updated_at"]
    )
    op.execute("ALTER TABLE mentor_conversations ENABLE ROW LEVEL SECURITY")
    op.add_column("mentor_messages", sa.Column("conversation_id", sa.Uuid(), nullable=True))
    op.add_column("mentor_messages", sa.Column("parts", postgresql.JSONB(), nullable=True))
    op.create_foreign_key(
        "fk_mentor_messages_conversation_id_mentor_conversations",
        "mentor_messages",
        "mentor_conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_mentor_messages_conversation", "mentor_messages", ["conversation_id", "created_at"]
    )
    # Each learner's messages so far: one conversation, named after its first question.
    op.execute(
        """
        INSERT INTO mentor_conversations (id, user_id, title, created_at, updated_at)
        SELECT gen_random_uuid(), m.user_id,
               COALESCE(
                 (SELECT left(f.content, 80) FROM mentor_messages f
                   WHERE f.user_id = m.user_id AND f.role = 'user'
                   ORDER BY f.created_at LIMIT 1),
                 '…'),
               min(m.created_at), max(m.created_at)
        FROM mentor_messages m
        GROUP BY m.user_id
        """
    )
    op.execute(
        """
        UPDATE mentor_messages m SET conversation_id = c.id
        FROM mentor_conversations c WHERE c.user_id = m.user_id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_mentor_messages_conversation", table_name="mentor_messages")
    op.drop_constraint(
        "fk_mentor_messages_conversation_id_mentor_conversations",
        "mentor_messages",
        type_="foreignkey",
    )
    op.drop_column("mentor_messages", "parts")
    op.drop_column("mentor_messages", "conversation_id")
    op.drop_index("ix_mentor_conversations_user_updated", table_name="mentor_conversations")
    op.drop_table("mentor_conversations")
