"""client errors: what the app showed a learner as «Что-то пошло не так» (ADR 0094)

Revision ID: c3d5e7f9a124
Revises: b2c4d6e8f013
Create Date: 2026-11-26 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3d5e7f9a124"
down_revision: str | Sequence[str] | None = "b2c4d6e8f013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "client_errors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("place", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("stack", sa.Text(), nullable=False),
        sa.Column("build", sa.String(length=80), nullable=False),
        sa.Column("agent", sa.String(length=200), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_client_errors_user_id"), "client_errors", ["user_id"], unique=False)
    op.execute("ALTER TABLE client_errors ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index(op.f("ix_client_errors_user_id"), table_name="client_errors")
    op.drop_table("client_errors")
