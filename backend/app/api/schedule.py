"""Weekly schedule: recurring life commitments the mentor plans around."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.models import ScheduleEvent
from app.schemas.schedule import ScheduleEventIn, ScheduleEventOut, ScheduleEventsOut
from app.services.card_reports import listed

router = APIRouter(tags=["schedule"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _require_mentor(user: CurrentUser, settings: DepSettings) -> None:
    if not listed(user, settings.mentor_testers):
        raise ApiError(403, "not_a_mentor_tester", "The schedule is not available for this account")


def _to_out(event: ScheduleEvent) -> ScheduleEventOut:
    return ScheduleEventOut(
        id=event.id,
        title=event.title,
        kind=event.kind,
        weekdays=event.weekdays,
        start_minute=event.start_minute,
        end_minute=event.end_minute,
    )


@router.get("/mentor/schedule", dependencies=[Depends(_require_mentor)])
def list_schedule(user: CurrentUser, db: DbSession) -> ScheduleEventsOut:
    rows = db.scalars(
        select(ScheduleEvent)
        .where(ScheduleEvent.user_id == user.id)
        .order_by(ScheduleEvent.start_minute, ScheduleEvent.weekdays)
    ).all()
    return ScheduleEventsOut(events=[_to_out(e) for e in rows])


@router.post("/mentor/schedule", status_code=201, dependencies=[Depends(_require_mentor)])
def create_event(
    body: ScheduleEventIn, user: CurrentUser, db: DbSession, now: Now
) -> ScheduleEventOut:
    event = ScheduleEvent(
        user_id=user.id,
        title=body.title,
        kind=body.kind,
        weekdays=body.weekdays,
        start_minute=body.start_minute,
        end_minute=body.end_minute,
        created_at=now,
        updated_at=now,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _to_out(event)


@router.put("/mentor/schedule/{event_id}", dependencies=[Depends(_require_mentor)])
def update_event(
    event_id: uuid.UUID, body: ScheduleEventIn, user: CurrentUser, db: DbSession, now: Now
) -> ScheduleEventOut:
    event = db.get(ScheduleEvent, event_id)
    if event is None or event.user_id != user.id:
        raise ApiError(404, "event_not_found", "No such schedule event")
    event.title = body.title
    event.kind = body.kind
    event.weekdays = body.weekdays
    event.start_minute = body.start_minute
    event.end_minute = body.end_minute
    event.updated_at = now
    db.commit()
    db.refresh(event)
    return _to_out(event)


@router.delete(
    "/mentor/schedule/{event_id}", status_code=204, dependencies=[Depends(_require_mentor)]
)
def delete_event(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    event = db.get(ScheduleEvent, event_id)
    if event is None or event.user_id != user.id:
        raise ApiError(404, "event_not_found", "No such schedule event")
    db.delete(event)
    db.commit()
    return Response(status_code=204)
