"""Speaking feature HTTP endpoints (Chunk 2: session + audio upload, no AI yet)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.ratelimit import limit_speaking_sessions
from app.schemas.speaking import (
    CreateSessionIn,
    QuestionOut,
    SessionDetailOut,
    SessionOut,
    SessionSummaryOut,
)
from app.services.card_reports import listed
from app.services.speaking import questions as questions_svc
from app.services.speaking import sessions as sessions_svc
from app.services.speaking.storage import get_storage

router = APIRouter(tags=["speaking"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _require_speaking(user: CurrentUser, settings: DepSettings) -> None:
    if not listed(user, settings.speaking_testers):
        raise ApiError(403, "not_a_speaking_tester", "Speaking is not available for this account")


@router.get("/speaking/sessions", dependencies=[Depends(_require_speaking)])
def list_sessions(
    user: CurrentUser,
    db: DbSession,
    question_id: str | None = None,
) -> list[SessionSummaryOut]:
    return sessions_svc.list_for_user(db, user, question_id=question_id)


@router.get("/speaking/questions", dependencies=[Depends(_require_speaking)])
def list_questions(exercise_type: str | None = None) -> list[QuestionOut]:
    if exercise_type is not None and exercise_type not in ("spontaneous", "pronunciation"):
        raise ApiError(
            400, "invalid_exercise_type", "exercise_type must be spontaneous or pronunciation"
        )
    return [
        QuestionOut(
            id=q.id,
            exercise_type=q.exercise_type,
            text=q.text,
            topic=q.topic,
            level=q.level,
            reference_text=q.reference_text,
        )
        for q in questions_svc.list_all(exercise_type)
    ]


@router.post(
    "/speaking/sessions",
    dependencies=[Depends(_require_speaking), Depends(limit_speaking_sessions)],
)
def create_session(body: CreateSessionIn, user: CurrentUser, db: DbSession) -> SessionOut:
    return sessions_svc.create(db, user, body.exercise_type, body.question_id)


@router.get("/speaking/sessions/{session_id}", dependencies=[Depends(_require_speaking)])
def get_session(session_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SessionDetailOut:
    return sessions_svc.read(db, user, session_id)


@router.post("/speaking/sessions/{session_id}/audio", dependencies=[Depends(_require_speaking)])
async def upload_audio(
    session_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    settings: DepSettings,
    file: Annotated[UploadFile, File(description="Audio blob (webm/opus preferred)")],
    duration_ms: Annotated[int | None, Form(ge=0, le=sessions_svc.MAX_RECORDING_MS)] = None,
    sample_rate: Annotated[int | None, Form(ge=0, le=192_000)] = None,
) -> SessionDetailOut:
    content = await file.read()
    if file.content_type is None:
        raise ApiError(400, "missing_content_type", "Audio part is missing Content-Type.")
    storage = get_storage(settings)
    return await sessions_svc.upload_audio(
        db,
        storage,
        user,
        session_id,
        now,
        content=content,
        mime_type=file.content_type,
        duration_ms=duration_ms,
        sample_rate=sample_rate,
        max_bytes=settings.speaking_max_audio_bytes,
    )


@router.delete(
    "/speaking/sessions/{session_id}",
    status_code=204,
    dependencies=[Depends(_require_speaking)],
)
async def delete_session(
    session_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    settings: DepSettings,
) -> None:
    storage = get_storage(settings)
    await sessions_svc.soft_delete(db, storage, user, session_id, now)
