"""Sync of personal decks and settings (ADR 0061)."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.schemas.sync import PullOut, PushIn, PushOut
from app.services import sync

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
