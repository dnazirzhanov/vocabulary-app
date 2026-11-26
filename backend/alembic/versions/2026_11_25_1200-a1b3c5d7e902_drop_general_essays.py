"""writing: delete the essays answered to the old general questions (ADR 0090)

The owner's decision (25 November 2026): the non-IELTS questions go, and with them every essay
written to one, for good. Only IELTS Task 2 questions remain (ids «ielts-…»). Nothing refers to a
writing submission, so nothing else changes. There is no way back: downgrade leaves them gone.

Revision ID: a1b3c5d7e902
Revises: f8d2b6a4c013
Create Date: 2026-11-25 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "a1b3c5d7e902"
down_revision: str | Sequence[str] | None = "f8d2b6a4c013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM writing_submissions WHERE question_id NOT LIKE 'ielts-%'")


def downgrade() -> None:
    # Deleted essays can't be brought back.
    pass
