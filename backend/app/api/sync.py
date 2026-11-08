"""Sync of personal decks and settings (ADR 0061), and the study pack (ADR 0062)."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, SentTimeZone, TimeZone
from app.schemas.study import StudyPackOut
from app.schemas.sync import PullOut, PushIn, PushOut
from app.services import study_sync, sync

router = APIRouter(tags=["sync"])


@router.post("/sync/push")
def push(body: PushIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone) -> PushOut:
    """A device's changes, in the order made; each answered once, however often it is sent."""
    return sync.push(db, user, body, now, time_zone)


@router.get("/sync/decks")
def pull(
    user: CurrentUser,
    db: DbSession,
    now: Now,
    cursor: Annotated[int, Query(ge=0)] = 0,
    pulled_at: datetime | None = None,
) -> PullOut:
    """My decks changed since `cursor`, and those deleted; all of them when the device needs it."""
    return sync.pull(db, user, cursor, pulled_at, now)


@router.get("/study/pack", response_model=StudyPackOut)
def study_pack(
    request: Request,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    sent_zone: SentTimeZone,
    device_id: Annotated[UUID, Query()],
) -> Response:
    """Everything this device needs to study by itself: my decks and their words, my progress, my
    spelling, my pace. Tagged with its content: «not modified» when nothing changed. Sent once the
    device's own changes are in, it is also the device's contact: answers from it are never dated
    earlier."""
    sent = study_sync.pack_for(db, user, device_id, now, sent_zone)
    headers = {"ETag": sent.etag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match") == sent.etag:
        return Response(status_code=304, headers=headers)
    return Response(sent.body, media_type="application/json", headers=headers)
