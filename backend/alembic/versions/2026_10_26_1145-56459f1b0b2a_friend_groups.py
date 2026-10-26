"""friend groups

Revision ID: 56459f1b0b2a
Revises: 4cd60584f1f8
Create Date: 2026-10-26 11:45:15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "56459f1b0b2a"
down_revision: str | Sequence[str] | None = "4cd60584f1f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("invite_code", sa.String(length=8), nullable=False),
        sa.Column("time_zone", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_groups")),
        sa.UniqueConstraint("invite_code", name=op.f("uq_groups_invite_code")),
    )
    op.create_table(
        "group_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("nickname", sa.String(length=20), nullable=False),
        sa.Column("role", sa.String(length=8), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "role IN ('owner', 'member')", name=op.f("ck_group_members_role_values")
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name=op.f("fk_group_members_group_id_groups"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_group_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_group_members")),
        sa.UniqueConstraint("group_id", "user_id", name=op.f("uq_group_members_group_id_user_id")),
    )
    op.create_index(op.f("ix_group_members_user_id"), "group_members", ["user_id"], unique=False)
    op.create_index(
        "uq_group_members_group_id_nickname",
        "group_members",
        ["group_id", sa.text("lower(nickname)")],
        unique=True,
    )
    op.add_column("users", sa.Column("time_zone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "time_zone")
    op.drop_index("uq_group_members_group_id_nickname", table_name="group_members")
    op.drop_index(op.f("ix_group_members_user_id"), table_name="group_members")
    op.drop_table("group_members")
    op.drop_table("groups")
