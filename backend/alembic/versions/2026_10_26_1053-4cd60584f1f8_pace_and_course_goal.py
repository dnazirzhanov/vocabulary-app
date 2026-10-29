"""pace and course goal

Revision ID: 4cd60584f1f8
Revises: 8a4e2c7d1f03
Create Date: 2026-10-26 10:53:46

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4cd60584f1f8"
down_revision: str | Sequence[str] | None = "8a4e2c7d1f03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pace_dismissals",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_pace_dismissals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "kind", name=op.f("pk_pace_dismissals")),
    )
    op.add_column("decks", sa.Column("goal_words", sa.Integer(), nullable=True))
    op.add_column("decks", sa.Column("goal_coverage_percent", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("daily_target_words", sa.SmallInteger(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "study_days_per_week", sa.SmallInteger(), server_default=sa.text("6"), nullable=False
        ),
    )
    op.add_column(
        "users",
        sa.Column("ramp_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column("users", sa.Column("onboarded_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "daily_target_range", "users", "daily_target_words BETWEEN 1 AND 100"
    )
    op.create_check_constraint("study_days_range", "users", "study_days_per_week BETWEEN 1 AND 7")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_study_days_range"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_daily_target_range"), "users", type_="check")
    op.drop_column("users", "onboarded_at")
    op.drop_column("users", "ramp_enabled")
    op.drop_column("users", "study_days_per_week")
    op.drop_column("users", "daily_target_words")
    op.drop_column("decks", "goal_coverage_percent")
    op.drop_column("decks", "goal_words")
    op.drop_table("pace_dismissals")
