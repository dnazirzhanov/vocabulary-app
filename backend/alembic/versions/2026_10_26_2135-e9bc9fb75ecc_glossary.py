"""glossary

Revision ID: e9bc9fb75ecc
Revises: 08ab4ba7f111
Create Date: 2026-10-26 21:35:48

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e9bc9fb75ecc"
down_revision: str | Sequence[str] | None = "08ab4ba7f111"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "glossary",
        sa.Column("form", sa.String(length=64), nullable=False),
        sa.Column("ru", sa.String(length=200), nullable=False),
        sa.Column("lemma", sa.String(length=64), nullable=True),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.PrimaryKeyConstraint("form", name=op.f("pk_glossary")),
    )


def downgrade() -> None:
    op.drop_table("glossary")
