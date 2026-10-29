"""fsrs flashcards

Revision ID: 08ab4ba7f111
Revises: 56459f1b0b2a
Create Date: 2026-10-26 18:11:35

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "08ab4ba7f111"
down_revision: str | Sequence[str] | None = "56459f1b0b2a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("review_attempts", sa.Column("rating", sa.SmallInteger(), nullable=True))
    op.add_column(
        "review_attempts",
        sa.Column("was_review", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "user_word_progress",
        sa.Column("fsrs_state", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column("user_word_progress", sa.Column("fsrs_step", sa.SmallInteger(), nullable=True))
    op.add_column("user_word_progress", sa.Column("stability", sa.Float(), nullable=True))
    op.add_column("user_word_progress", sa.Column("difficulty", sa.Float(), nullable=True))
    # Every word met so far becomes a review card; its old Leitner interval (days) is the
    # starting estimate of its stability.
    op.execute(
        "UPDATE user_word_progress SET fsrs_state = 2, difficulty = 5, stability ="
        " CASE stage WHEN 1 THEN 1 WHEN 2 THEN 3 WHEN 3 THEN 7 WHEN 4 THEN 16 ELSE 35 END"
    )
    op.drop_constraint(
        op.f("ck_user_word_progress_stage_range"), "user_word_progress", type_="check"
    )
    op.drop_column("user_word_progress", "stage")
    op.create_check_constraint(
        "fsrs_state_range", "user_word_progress", "fsrs_state BETWEEN 1 AND 3"
    )

    # Quiz sessions still open cannot be continued as flashcards: close them.
    op.execute("UPDATE learning_sessions SET completed_at = now() WHERE completed_at IS NULL")
    op.drop_constraint(op.f("ck_learning_sessions_kind"), "learning_sessions", type_="check")
    op.create_check_constraint(
        "kind", "learning_sessions", "kind IN ('new', 'practice', 'review', 'study', 'hard')"
    )
    op.drop_constraint(
        op.f("ck_review_attempts_correct_only_for_answers"), "review_attempts", type_="check"
    )
    op.create_check_constraint(
        "correct_only_for_answers",
        "review_attempts",
        "(exercise_type IN ('introduce', 'card')) = (correct IS NULL)",
    )
    op.create_check_constraint(
        "rating_for_cards", "review_attempts", "(exercise_type = 'card') = (rating IS NOT NULL)"
    )
    op.create_check_constraint("rating_range", "review_attempts", "rating BETWEEN 1 AND 4")


def downgrade() -> None:
    op.execute("DELETE FROM learning_sessions WHERE kind IN ('study', 'hard')")
    op.drop_constraint(op.f("ck_review_attempts_rating_range"), "review_attempts", type_="check")
    op.drop_constraint(
        op.f("ck_review_attempts_rating_for_cards"), "review_attempts", type_="check"
    )
    op.drop_constraint(
        op.f("ck_review_attempts_correct_only_for_answers"), "review_attempts", type_="check"
    )
    op.create_check_constraint(
        "correct_only_for_answers",
        "review_attempts",
        "(exercise_type = 'introduce') = (correct IS NULL)",
    )
    op.drop_constraint(op.f("ck_learning_sessions_kind"), "learning_sessions", type_="check")
    op.create_check_constraint("kind", "learning_sessions", "kind IN ('new', 'practice', 'review')")

    op.drop_constraint(
        op.f("ck_user_word_progress_fsrs_state_range"), "user_word_progress", type_="check"
    )
    op.add_column(
        "user_word_progress",
        sa.Column("stage", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
    )
    op.execute(
        "UPDATE user_word_progress SET stage = CASE WHEN stability >= 35 THEN 5"
        " WHEN stability >= 16 THEN 4 WHEN stability >= 7 THEN 3 WHEN stability >= 3 THEN 2"
        " ELSE 1 END"
    )
    op.create_check_constraint("stage_range", "user_word_progress", "stage BETWEEN 1 AND 5")
    op.drop_column("user_word_progress", "difficulty")
    op.drop_column("user_word_progress", "stability")
    op.drop_column("user_word_progress", "fsrs_step")
    op.drop_column("user_word_progress", "fsrs_state")
    op.drop_column("review_attempts", "was_review")
    op.drop_column("review_attempts", "rating")
