"""readings: texts people add to Reading Mode, and their categories

Revision ID: c4a7d2e9f513
Revises: b8f3e1a6c204
Create Date: 2026-11-12 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4a7d2e9f513"
down_revision: str | Sequence[str] | None = "b8f3e1a6c204"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reading_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_reading_categories_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reading_categories")),
    )
    op.create_index(op.f("ix_reading_categories_owner_id"), "reading_categories", ["owner_id"])
    op.create_index(
        "uq_reading_categories_name",
        "reading_categories",
        ["owner_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "readings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("words", sa.Integer(), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("level", sa.String(length=2), nullable=True),
        sa.Column("glossary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('drafting', 'ready', 'failed')", name=op.f("ck_readings_status")
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["reading_categories.id"],
            name=op.f("fk_readings_category_id_reading_categories"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_readings_owner_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_readings")),
    )
    op.create_index(op.f("ix_readings_owner_id"), "readings", ["owner_id"])
    op.create_index(op.f("ix_readings_category_id"), "readings", ["category_id"])
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE reading_categories ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE readings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("readings")
    op.drop_table("reading_categories")
