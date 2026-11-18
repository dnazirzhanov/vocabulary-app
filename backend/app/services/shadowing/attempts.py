"""Shadowing attempt CRUD operations."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.shadowing import ShadowingAttempt
from app.models.user import User

if TYPE_CHECKING:
    from app.services.speaking.storage import StorageClient


def create(db: Session, user: User, exercise_id: uuid.UUID) -> ShadowingAttempt:
    attempt = ShadowingAttempt(user_id=user.id, exercise_id=exercise_id)
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


async def upload_audio(
    db: Session,
    storage: StorageClient,
    attempt: ShadowingAttempt,
    content: bytes,
    mime_type: str,
    duration_ms: int | None,
) -> None:
    path = f"shadowing/{attempt.user_id}/{attempt.id}.webm"
    await storage.upload(path, content, mime_type)
    attempt.audio_path = path
    attempt.audio_mime_type = mime_type
    attempt.duration_ms = duration_ms
    db.commit()


def complete(db: Session, attempt: ShadowingAttempt) -> ShadowingAttempt:
    attempt.completed_at = datetime.now(UTC)
    db.commit()
    db.refresh(attempt)
    return attempt


def list_for_user(
    db: Session, user_id: uuid.UUID, exercise_id: uuid.UUID | None = None
) -> list[ShadowingAttempt]:
    q = select(ShadowingAttempt).where(ShadowingAttempt.user_id == user_id)
    if exercise_id is not None:
        q = q.where(ShadowingAttempt.exercise_id == exercise_id)
    return list(db.scalars(q.order_by(ShadowingAttempt.created_at.desc())))


def get_own(db: Session, attempt_id: uuid.UUID, user_id: uuid.UUID) -> ShadowingAttempt | None:
    return db.scalar(
        select(ShadowingAttempt).where(
            ShadowingAttempt.id == attempt_id,
            ShadowingAttempt.user_id == user_id,
        )
    )
