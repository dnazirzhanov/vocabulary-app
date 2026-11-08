"""lessons planned on a device: where a session was planned, and the devices that study (ADR 0062)

Revision ID: a3d6f8b2c917
Revises: f2c9d4e7a518
Create Date: 2026-11-08 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3d6f8b2c917"
down_revision: str | Sequence[str] | None = "f2c9d4e7a518"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OPEN = "completed_at IS NULL AND set_aside_at IS NULL"


def _open_index(where: str) -> None:
    op.drop_index("uq_learning_sessions_open_per_user", table_name="learning_sessions")
    op.create_index(
        "uq_learning_sessions_open_per_user",
        "learning_sessions",
        ["user_id", sa.text("(kind = 'spelling')")],
        unique=True,
        postgresql_where=sa.text(where),
    )


def upgrade() -> None:
    op.add_column(
        "learning_sessions",
        sa.Column("origin", sa.String(length=8), server_default="server", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_learning_sessions_origin"), "learning_sessions", "origin IN ('server', 'device')"
    )
    # One open lesson per learner among those the server planned; a device's are its own.
    _open_index(f"{OPEN} AND origin = 'server'")
    op.create_table(
        "sync_devices",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_sync_devices_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "device_id", name=op.f("pk_sync_devices")),
    )
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE sync_devices ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("sync_devices")
    # Device lessons left open would break the wider index: they are closed as set aside.
    op.execute(
        "UPDATE learning_sessions SET set_aside_at = started_at"
        " WHERE completed_at IS NULL AND set_aside_at IS NULL AND origin = 'device'"
    )
    _open_index(OPEN)
    op.drop_constraint(op.f("ck_learning_sessions_origin"), "learning_sessions", type_="check")
    op.drop_column("learning_sessions", "origin")
