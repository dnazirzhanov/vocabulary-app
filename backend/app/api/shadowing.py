"""Shadowing feature HTTP endpoints."""

import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from fastapi.responses import Response

from app.core.auth import CurrentUser, DbSession
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.schemas.shadowing import (
    AttemptListItem,
    AttemptOut,
    CreateAttemptIn,
    ExerciseOut,
    ExerciseStatusOut,
    SentenceOut,
)
from app.services.shadowing import attempts as attempts_svc
from app.services.shadowing import exercises as exercises_svc
from app.services.speaking.storage import get_storage

router = APIRouter(tags=["shadowing"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _exercise_out(ex) -> ExerciseOut:  # type: ignore[no-untyped-def]
    return ExerciseOut(
        id=ex.id,
        slug=ex.slug,
        title=ex.title,
        description=ex.description,
        difficulty=ex.difficulty,
        language=ex.language,
        duration_ms=ex.duration_ms,
        transcript=ex.transcript,
        sentences=[SentenceOut(**s) for s in (ex.sentences or [])],
        speaker=ex.speaker,
        has_audio=bool(ex.audio_path),
        display_order=ex.display_order,
    )


@router.get("/shadowing/exercises")
def list_exercises(db: DbSession, user: CurrentUser) -> list[ExerciseOut]:
    return [_exercise_out(ex) for ex in exercises_svc.list_active(db)]


@router.get("/shadowing/exercises/{exercise_id}/audio")
def get_exercise_audio(
    exercise_id: uuid.UUID,
    db: DbSession,
    settings: DepSettings,
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    ex = exercises_svc.by_id(db, exercise_id)
    if ex is None or not ex.is_active:
        raise ApiError(404, "exercise_not_found", "Exercise not found")
    if not ex.audio_path:
        raise ApiError(404, "audio_not_available", "Audio not available for this exercise")

    storage = get_storage(settings)
    if storage.mode == "supabase":
        # Return signed URL redirect
        import httpx2 as httpx

        base = settings.supabase_url
        key = settings.supabase_secret_key
        if not base or key is None:
            raise ApiError(503, "storage_misconfigured", "Supabase not configured")
        url = f"{base}/storage/v1/object/sign/{settings.speaking_audio_bucket}/{ex.audio_path}"
        resp = httpx.post(
            url,
            json={"expiresIn": 3600},
            headers={"Authorization": f"Bearer {key.get_secret_value()}"},
            timeout=10.0,
        )
        if resp.status_code >= 400:
            raise ApiError(502, "storage_error", "Could not generate audio URL")
        signed = resp.json().get("signedURL", "")
        # Supabase returns a relative path (e.g. /object/sign/…); make it absolute.
        if signed.startswith("/"):
            signed = f"{base}/storage/v1{signed}"
        return Response(status_code=302, headers={"Location": signed})

    # FileSystem (development, tests): served here, with byte ranges so the player can seek.
    data = storage.download_sync(ex.audio_path)
    return audio_response(
        data,
        ex.audio_mime_type or "audio/mpeg",
        range_header,
        cache="public, max-age=3600",
    )


@router.post("/shadowing/attempts")
def create_attempt(
    body: CreateAttemptIn,
    db: DbSession,
    user: CurrentUser,
) -> AttemptOut:
    ex = exercises_svc.by_id(db, body.exercise_id)
    if ex is None or not ex.is_active:
        raise ApiError(404, "exercise_not_found", "Exercise not found")
    attempt = attempts_svc.create(db, user, body.exercise_id)
    return AttemptOut(
        id=attempt.id,
        exercise_id=attempt.exercise_id,
        duration_ms=attempt.duration_ms,
        completed_at=attempt.completed_at,
        created_at=attempt.created_at,
    )


@router.post("/shadowing/attempts/{attempt_id}/audio")
async def upload_attempt_audio(
    attempt_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    settings: DepSettings,
    file: UploadFile = File(...),  # noqa: B008
    duration_ms: int | None = Form(None),
) -> AttemptOut:
    attempt = attempts_svc.get_own(db, attempt_id, user.id)
    if attempt is None:
        raise ApiError(404, "attempt_not_found", "Attempt not found")
    content = await file.read()
    if len(content) > settings.speaking_max_audio_bytes:
        raise ApiError(413, "audio_too_large", "Recording exceeds maximum allowed size")
    mime = file.content_type or "audio/webm"
    storage = get_storage(settings)
    await attempts_svc.upload_audio(db, storage, attempt, content, mime, duration_ms)
    return AttemptOut(
        id=attempt.id,
        exercise_id=attempt.exercise_id,
        duration_ms=attempt.duration_ms,
        completed_at=attempt.completed_at,
        created_at=attempt.created_at,
    )


@router.get("/shadowing/attempts/{attempt_id}/audio")
def get_attempt_audio(
    attempt_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    settings: DepSettings,
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    attempt = attempts_svc.get_own(db, attempt_id, user.id)
    if attempt is None:
        raise ApiError(404, "attempt_not_found", "Attempt not found")
    if not attempt.audio_path:
        raise ApiError(404, "audio_not_available", "Audio not uploaded yet")

    storage = get_storage(settings)
    data = storage.download_sync(attempt.audio_path)
    return audio_response(
        data, attempt.audio_mime_type or "audio/webm", range_header, cache="private"
    )


_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


def audio_response(
    data: bytes, media_type: str, range_header: str | None, *, cache: str
) -> Response:
    """The audio with its length, or the byte range asked for (206).

    Browsers seek in audio with Range requests; a reply without a length or ranges leaves the
    player unable to seek and showing no duration."""
    size = len(data)
    headers = {"Accept-Ranges": "bytes", "Cache-Control": cache}
    match = _RANGE.fullmatch((range_header or "").strip())
    if not match or not size:
        return Response(content=data, media_type=media_type, headers=headers)
    first, last = match.groups()
    if first:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    elif last:  # "bytes=-500": the last 500 bytes
        start, end = max(0, size - int(last)), size - 1
    else:
        return Response(content=data, media_type=media_type, headers=headers)
    if start >= size or start > end:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    return Response(
        content=data[start : end + 1],
        status_code=206,
        media_type=media_type,
        headers={**headers, "Content-Range": f"bytes {start}-{end}/{size}"},
    )


@router.post("/shadowing/attempts/{attempt_id}/complete")
def complete_attempt(
    attempt_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> AttemptOut:
    attempt = attempts_svc.get_own(db, attempt_id, user.id)
    if attempt is None:
        raise ApiError(404, "attempt_not_found", "Attempt not found")
    attempt = attempts_svc.complete(db, attempt)
    return AttemptOut(
        id=attempt.id,
        exercise_id=attempt.exercise_id,
        duration_ms=attempt.duration_ms,
        completed_at=attempt.completed_at,
        created_at=attempt.created_at,
    )


@router.get("/shadowing/exercises/{exercise_id}/attempts")
def get_exercise_attempts(
    exercise_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> ExerciseStatusOut:
    ex = exercises_svc.by_id(db, exercise_id)
    if ex is None or not ex.is_active:
        raise ApiError(404, "exercise_not_found", "Exercise not found")
    all_attempts = attempts_svc.list_for_user(db, user.id, exercise_id)
    return ExerciseStatusOut(
        exercise_id=exercise_id,
        attempts_count=len(all_attempts),
        completed_count=sum(1 for a in all_attempts if a.completed_at is not None),
        last_attempted_at=all_attempts[0].created_at if all_attempts else None,
    )


@router.get("/shadowing/exercises/{exercise_id}/my-attempts")
def list_my_attempts(
    exercise_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> list[AttemptListItem]:
    ex = exercises_svc.by_id(db, exercise_id)
    if ex is None or not ex.is_active:
        raise ApiError(404, "exercise_not_found", "Exercise not found")
    all_attempts = attempts_svc.list_for_user(db, user.id, exercise_id)
    return [
        AttemptListItem(
            id=a.id,
            duration_ms=a.duration_ms,
            completed_at=a.completed_at,
            created_at=a.created_at,
            has_audio=bool(a.audio_path),
        )
        for a in all_attempts
    ]
