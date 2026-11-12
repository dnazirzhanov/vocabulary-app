"""reading assignments: a reading given to a group, with its words, questions and deadline

Revision ID: f3b8d1a6e924
Revises: e7a1c3f9b026
Create Date: 2026-11-12 17:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3b8d1a6e924"
down_revision: str | Sequence[str] | None = "e7a1c3f9b026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reading_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("reading_ref", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("given_by", sa.Uuid(), nullable=True),
        sa.Column("deck_id", sa.String(length=64), nullable=True),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("given_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name=op.f("fk_reading_assignments_group_id_groups"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["given_by"],
            ["users.id"],
            name=op.f("fk_reading_assignments_given_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["deck_id"],
            ["decks.id"],
            name=op.f("fk_reading_assignments_deck_id_decks"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reading_assignments")),
    )
    op.create_index(op.f("ix_reading_assignments_group_id"), "reading_assignments", ["group_id"])
    op.create_index(op.f("ix_reading_assignments_given_by"), "reading_assignments", ["given_by"])
    # A reading's own questions, or a given reading's copy: the running version writes only the
    # first, which stays allowed.
    op.add_column("reading_questions", sa.Column("assignment_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_reading_questions_assignment_id_reading_assignments"),
        "reading_questions",
        "reading_assignments",
        ["assignment_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        op.f("ix_reading_questions_assignment_id"), "reading_questions", ["assignment_id"]
    )
    op.alter_column("reading_questions", "reading_id", nullable=True)
    op.create_check_constraint(
        op.f("ck_reading_questions_belongs"),
        "reading_questions",
        "reading_id IS NOT NULL OR assignment_id IS NOT NULL",
    )
    # Nothing new is reachable through Supabase's Data API (ADR 0058).
    op.execute("ALTER TABLE reading_assignments ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("DELETE FROM reading_questions WHERE reading_id IS NULL")
    op.drop_constraint(op.f("ck_reading_questions_belongs"), "reading_questions", type_="check")
    op.alter_column("reading_questions", "reading_id", nullable=False)
    op.drop_index(op.f("ix_reading_questions_assignment_id"), table_name="reading_questions")
    op.drop_constraint(
        op.f("fk_reading_questions_assignment_id_reading_assignments"),
        "reading_questions",
        type_="foreignkey",
    )
    op.drop_column("reading_questions", "assignment_id")
    op.drop_table("reading_assignments")
