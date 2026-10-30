"""spelling progress

Revision ID: 5e1f0a7c9b2d
Revises: 768dd88c484e
Create Date: 2026-10-30 12:00:00

"""

from collections.abc import Sequence
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from alembic import op

revision: str = "5e1f0a7c9b2d"
down_revision: str | Sequence[str] | None = "768dd88c484e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ADR 0026, frozen here: the ladder's rungs and waits, days from 4 AM local time.
KNOWN = 3
WAIT_DAYS = {0: 1, 1: 3, 2: 7, 3: 21}


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _due(rung: int, now: datetime, zone: ZoneInfo) -> datetime:
    day = (now.astimezone(zone) - timedelta(hours=4)).date() + timedelta(days=WAIT_DAYS[rung])
    return datetime.combine(day, time(4), tzinfo=zone)


def upgrade() -> None:
    table = op.create_table(
        "spelling_progress",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("word_id", sa.String(length=64), nullable=False),
        sa.Column("rung", sa.SmallInteger(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_spelled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("misses", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint("rung BETWEEN 0 AND 3", name=op.f("ck_spelling_progress_rung_range")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_spelling_progress_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["word_id"], ["words.id"], name=op.f("fk_spelling_progress_word_id_words")
        ),
        sa.PrimaryKeyConstraint("user_id", "word_id", name=op.f("pk_spelling_progress")),
    )
    op.create_index(
        "ix_spelling_progress_user_due", "spelling_progress", ["user_id", "due_at"], unique=False
    )

    # Replay every spelling answer so far (only first tries are stored), in order.
    rows = op.get_bind().execute(
        sa.text(
            """
            SELECT a.user_id, a.word_id, a.exercise_id, a.correct, a.answered_at, s.plan,
                   u.time_zone
            FROM review_attempts a
            JOIN learning_sessions s ON s.id = a.session_id
            JOIN users u ON u.id = a.user_id
            WHERE a.exercise_type = 'spelling'
            ORDER BY a.answered_at, a.id
            """
        )
    )
    ladder: dict[tuple[object, str], dict[str, object]] = {}
    for user_id, word_id, exercise_id, correct, answered_at, plan, zone_name in rows:
        hinted = any(
            step.get("id") == exercise_id and step.get("hint") is not None for step in plan or []
        )
        right = bool(correct) and not hinted
        zone = _zone(zone_name)
        before = ladder.get((user_id, word_id))
        if right and before is not None and before["due_at"] > answered_at:  # type: ignore[operator]
            before["last_spelled_at"] = answered_at
            continue
        rung = 0 if not right else (1 if before is None else min(int(before["rung"]) + 1, KNOWN))  # type: ignore[call-overload]
        misses = (int(before["misses"]) if before else 0) + int(not right)  # type: ignore[call-overload]
        ladder[(user_id, word_id)] = {
            "user_id": user_id,
            "word_id": word_id,
            "rung": rung,
            "due_at": _due(rung, answered_at, zone),
            "last_spelled_at": answered_at,
            "misses": misses,
        }
    if ladder:
        op.bulk_insert(table, list(ladder.values()))


def downgrade() -> None:
    op.drop_index("ix_spelling_progress_user_due", table_name="spelling_progress")
    op.drop_table("spelling_progress")
