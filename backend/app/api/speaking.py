"""Speaking feature HTTP endpoints (Chunk 2: session + audio upload, no AI yet)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, Response, UploadFile
from sqlalchemy import select

from app.api.shadowing import audio_response
from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.ratelimit import limit_speaking_sessions
from app.models import GroupMember
from app.schemas.speaking import (
    CreateSessionIn,
    QuestionOut,
    SessionDetailOut,
    SessionOut,
    SessionSummaryOut,
)
from app.services import task_links
from app.services.card_reports import listed
from app.services.speaking import questions as questions_svc
from app.services.speaking import sessions as sessions_svc
from app.services.speaking.storage import get_storage

router = APIRouter(tags=["speaking"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _teaches(db: DbSession, user: CurrentUser) -> bool:
    """Sets a group's tasks: picks a speaking question for one (ADR 0096)."""
    return (
        db.scalar(
            select(GroupMember.group_id).where(
                GroupMember.user_id == user.id, GroupMember.role == "owner"
            )
        )
        is not None
    )


def _require_speaking(user: CurrentUser, db: DbSession, settings: DepSettings) -> None:
    """A tester; or a teacher, to pick questions for a group's tasks; or a member of a group whose
    task links a speaking question, for that question (ADR 0096)."""
    if listed(user, settings.speaking_testers) or _teaches(db, user):
        return
    if not task_links.linked_refs(db, user, "speaking"):
        raise ApiError(403, "not_a_speaking_tester", "Speaking is not available for this account")


def _may_answer(db: DbSession, user: CurrentUser, settings: DepSettings, question_id: str) -> None:
    """Recording an answer: a tester, any question; anyone else, one their group's task links."""
    if listed(user, settings.speaking_testers):
        return
    if question_id not in task_links.linked_refs(db, user, "speaking"):
        raise ApiError(403, "not_a_speaking_tester", "Speaking is not available for this account")


@router.get("/speaking/sessions", dependencies=[Depends(_require_speaking)])
def list_sessions(
    user: CurrentUser,
    db: DbSession,
    question_id: str | None = None,
) -> list[SessionSummaryOut]:
    return sessions_svc.list_for_user(db, user, question_id=question_id)


@router.get("/speaking/questions", dependencies=[Depends(_require_speaking)])
def list_questions(
    user: CurrentUser, db: DbSession, settings: DepSettings, exercise_type: str | None = None
) -> list[QuestionOut]:
    # A member who isn't a tester sees only what their groups' tasks link (ADR 0096).
    only = (
        None
        if listed(user, settings.speaking_testers) or _teaches(db, user)
        else task_links.linked_refs(db, user, "speaking")
    )
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
        if only is None or q.id in only
    ]


@router.post(
    "/speaking/sessions",
    dependencies=[Depends(_require_speaking), Depends(limit_speaking_sessions)],
)
def create_session(
    body: CreateSessionIn, user: CurrentUser, db: DbSession, settings: DepSettings
) -> SessionOut:
    _may_answer(db, user, settings, body.question_id)
    return sessions_svc.create(db, user, body.exercise_type, body.question_id)


@router.get("/speaking/sessions/{session_id}", dependencies=[Depends(_require_speaking)])
def get_session(session_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SessionDetailOut:
    return sessions_svc.read(db, user, session_id)


@router.get("/speaking/sessions/{session_id}/audio", dependencies=[Depends(_require_speaking)])
def get_audio(
    session_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    settings: DepSettings,
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    """The learner's own recording of one attempt, to listen to again (seekable: Range/206)."""
    asset = sessions_svc.audio_of(db, user, session_id)
    data = get_storage(settings).download_sync(asset.storage_path)
    media_type = asset.mime_type.split(";", 1)[0].strip()
    return audio_response(data, media_type, range_header, cache="private, max-age=3600")


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
