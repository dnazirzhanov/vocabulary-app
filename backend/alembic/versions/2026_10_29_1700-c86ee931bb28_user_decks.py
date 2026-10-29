"""user decks

Revision ID: c86ee931bb28
Revises: 22b706d20a22
Create Date: 2026-10-29 17:00:00

"""

from collections.abc import Sequence

from alembic import op

revision: str = "c86ee931bb28"
down_revision: str | Sequence[str] | None = "22b706d20a22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADR 0019: anyone writes decks; a deck someone wrote is "user", personal until given to a
    # group (the assignment, not the kind, makes it a group's deck).
    op.drop_constraint(op.f("ck_decks_kind_values"), "decks", type_="check")
    op.execute("UPDATE decks SET kind = 'user' WHERE kind = 'group'")
    op.create_check_constraint("kind_values", "decks", "kind IN ('course', 'user')")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_decks_kind_values"), "decks", type_="check")
    op.execute("UPDATE decks SET kind = 'group' WHERE kind = 'user'")
    op.create_check_constraint("kind_values", "decks", "kind IN ('course', 'group')")
