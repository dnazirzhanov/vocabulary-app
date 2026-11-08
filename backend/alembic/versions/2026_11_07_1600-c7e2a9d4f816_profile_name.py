"""one name per person, shown in every group, instead of a nickname per group (ADR 0057)

Revision ID: c7e2a9d4f816
Revises: b5d0f7a2c463
Create Date: 2026-11-07 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7e2a9d4f816"
down_revision: str | Sequence[str] | None = "b5d0f7a2c463"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # `display_name` was never written; it becomes the name, null until the learner gives one.
    op.alter_column("users", "display_name", new_column_name="name", type_=sa.String(length=20))
    # Someone already in a group keeps the nickname of the first group they joined.
    op.execute(
        """
        UPDATE users SET name = first.nickname
        FROM (
            SELECT DISTINCT ON (user_id) user_id, nickname
            FROM group_members ORDER BY user_id, joined_at, id
        ) AS first
        WHERE users.id = first.user_id
        """
    )
    op.drop_index("uq_group_members_group_id_nickname", table_name="group_members")
    op.drop_column("group_members", "nickname")


def downgrade() -> None:
    op.add_column("group_members", sa.Column("nickname", sa.String(length=20), nullable=True))
    op.execute(
        """
        UPDATE group_members SET nickname = COALESCE(users.name, 'Участник')
        FROM users WHERE users.id = group_members.user_id
        """
    )
    op.alter_column("group_members", "nickname", nullable=False)
    # Not unique any more: two members of a group may now share a name. The index exists so the
    # earlier migration's downgrade can drop it.
    op.create_index(
        "uq_group_members_group_id_nickname",
        "group_members",
        ["group_id", sa.text("lower(nickname)")],
    )
    op.alter_column("users", "name", new_column_name="display_name", type_=sa.String(length=80))
