"""promise weekdays and pauses (ADR 0039)

Revision ID: b6613ef67888
Revises: 0a04b4717094
Create Date: 2026-11-03 22:20:34.629653

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b6613ef67888"
down_revision: str | Sequence[str] | None = "0a04b4717094"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "promise_changes",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("weekdays", sa.SmallInteger(), nullable=False),
        sa.CheckConstraint(
            "weekdays BETWEEN 1 AND 127", name=op.f("ck_promise_changes_weekdays_range")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_promise_changes_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "effective_from", name=op.f("pk_promise_changes")),
    )
    op.create_table(
        "promise_pauses",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("until_date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_promise_pauses_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_promise_pauses")),
    )


def downgrade() -> None:
    op.drop_table("promise_pauses")
    op.drop_table("promise_changes")
