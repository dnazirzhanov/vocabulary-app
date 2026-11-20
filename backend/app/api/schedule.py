"""Weekly schedule: recurring life commitments the mentor plans around."""

import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.models import ScheduleEvent, ScheduleSkip, User
from app.schemas.schedule import ScheduleEventIn, ScheduleEventOut, ScheduleEventsOut, SkipIn
from app.services.card_reports import listed

router = APIRouter(tags=["schedule"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _require_mentor(user: CurrentUser, settings: DepSettings) -> None:
    if not listed(user, settings.mentor_testers):
        raise ApiError(403, "not_a_mentor_tester", "The schedule is not available for this account")


def _to_out(event: ScheduleEvent, skipped: list[date] | None = None) -> ScheduleEventOut:
    return ScheduleEventOut(
        id=event.id,
        title=event.title,
        kind=event.kind,
        weekdays=event.weekdays,
        start_minute=event.start_minute,
        end_minute=event.end_minute,
        on_date=event.on_date,
        skipped=skipped or [],
    )


def _weekdays(body: ScheduleEventIn) -> int:
    """A one-off block repeats on nothing: its weekdays are its date's weekday."""
    return 1 << body.on_date.weekday() if body.on_date else body.weekdays


def _mine(db: Session, user: User, event_id: uuid.UUID) -> ScheduleEvent:
    event = db.get(ScheduleEvent, event_id)
    if event is None or event.user_id != user.id:
        raise ApiError(404, "event_not_found", "No such schedule event")
    return event


@router.get("/mentor/schedule", dependencies=[Depends(_require_mentor)])
def list_schedule(
    user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> ScheduleEventsOut:
    """Repeating blocks with their skipped dates, and one-off blocks from a week ago on."""
    since = now.astimezone(time_zone).date() - timedelta(days=7)
    rows = db.scalars(
        select(ScheduleEvent)
        .where(
            ScheduleEvent.user_id == user.id,
            or_(ScheduleEvent.on_date.is_(None), ScheduleEvent.on_date >= since),
        )
        .order_by(ScheduleEvent.start_minute, ScheduleEvent.weekdays)
    ).all()
    skips: dict[uuid.UUID, list[date]] = {}
    for event_id, day in db.execute(
        select(ScheduleSkip.event_id, ScheduleSkip.date).where(
            ScheduleSkip.event_id.in_([e.id for e in rows]), ScheduleSkip.date >= since
        )
    ):
        skips.setdefault(event_id, []).append(day)
    return ScheduleEventsOut(events=[_to_out(e, sorted(skips.get(e.id, []))) for e in rows])


@router.post(
    "/mentor/schedule/{event_id}/skips", status_code=204, dependencies=[Depends(_require_mentor)]
)
def skip_day(event_id: uuid.UUID, body: SkipIn, user: CurrentUser, db: DbSession) -> Response:
    """«Только в этот день: не будет»: a repeating block off on one date. Repeating is harmless."""
    event = _mine(db, user, event_id)
    if event.on_date is None and not db.get(ScheduleSkip, (event.id, body.date)):
        db.add(ScheduleSkip(event_id=event.id, date=body.date))
        db.commit()
    return Response(status_code=204)


@router.delete(
    "/mentor/schedule/{event_id}/skips/{day}",
    status_code=204,
    dependencies=[Depends(_require_mentor)],
)
def unskip_day(event_id: uuid.UUID, day: date, user: CurrentUser, db: DbSession) -> Response:
    event = _mine(db, user, event_id)
    skip = db.get(ScheduleSkip, (event.id, day))
    if skip is not None:
        db.delete(skip)
        db.commit()
    return Response(status_code=204)


@router.post("/mentor/schedule", status_code=201, dependencies=[Depends(_require_mentor)])
def create_event(
    body: ScheduleEventIn, user: CurrentUser, db: DbSession, now: Now
) -> ScheduleEventOut:
    event = ScheduleEvent(
        user_id=user.id,
        title=body.title,
        kind=body.kind,
        weekdays=_weekdays(body),
        start_minute=body.start_minute,
        end_minute=body.end_minute,
        on_date=body.on_date,
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
    event = _mine(db, user, event_id)
    event.title = body.title
    event.kind = body.kind
    event.weekdays = _weekdays(body)
    event.on_date = body.on_date
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
    event = _mine(db, user, event_id)
    db.delete(event)
    db.commit()
    return Response(status_code=204)
