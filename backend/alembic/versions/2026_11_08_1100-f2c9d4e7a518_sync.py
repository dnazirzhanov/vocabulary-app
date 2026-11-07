"""personal decks sync: versions, change numbers, tombstones and an operations ledger (ADR 0061)

Revision ID: f2c9d4e7a518
Revises: e5b8c2d6f419
Create Date: 2026-11-08 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2c9d4e7a518"
down_revision: str | Sequence[str] | None = "e5b8c2d6f419"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEXT = sa.text("nextval('sync_change_seq')")


def upgrade() -> None:
    op.execute("CREATE SEQUENCE sync_change_seq")
    for table in ("decks", "words"):
        op.add_column(table, sa.Column("version", sa.Integer(), server_default="1", nullable=False))
        op.add_column(table, sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    # Every existing deck gets its own number: a device's first pull takes them all anyway.
    op.add_column(
        "decks", sa.Column("change_seq", sa.BigInteger(), server_default=NEXT, nullable=False)
    )
    op.create_index(op.f("ix_decks_owner_id_change_seq"), "decks", ["owner_id", "change_seq"])
    op.create_table(
        "sync_tombstones",
        sa.Column("entity", sa.String(length=8), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("deck_id", sa.String(length=64), nullable=True),
        sa.Column("change_seq", sa.BigInteger(), server_default=NEXT, nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("entity IN ('deck', 'word')", name=op.f("ck_sync_tombstones_entity")),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_sync_tombstones_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("entity", "entity_id", name=op.f("pk_sync_tombstones")),
    )
    op.create_index(
        op.f("ix_sync_tombstones_owner_id_change_seq"),
        "sync_tombstones",
        ["owner_id", "change_seq"],
    )
    op.create_index(op.f("ix_sync_tombstones_deleted_at"), "sync_tombstones", ["deleted_at"])
    op.create_table(
        "sync_ops",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("op_id", sa.Uuid(), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sync_ops_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "op_id", name=op.f("pk_sync_ops")),
    )
    op.create_index(op.f("ix_sync_ops_applied_at"), "sync_ops", ["applied_at"])
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    for table in ("sync_tombstones", "sync_ops"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("sync_ops")
    op.drop_table("sync_tombstones")
    op.drop_index(op.f("ix_decks_owner_id_change_seq"), table_name="decks")
    op.drop_column("decks", "change_seq")
    for table in ("decks", "words"):
        op.drop_column(table, "updated_at")
        op.drop_column(table, "version")
    op.execute("DROP SEQUENCE sync_change_seq")
