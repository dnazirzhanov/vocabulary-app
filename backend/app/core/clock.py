"""The current time, as one dependency, so reviews can be tested without waiting days.

Responses carry the server's time (X-Server-Time). The web app counts "tomorrow" and "in 3 days"
from it instead of the device clock, which is often wrong on phones.
"""

from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, Request, Response

from app.core.config import Settings, get_settings
from app.core.errors import ApiError

DEV_NOW_HEADER = "X-Dev-Now"
SERVER_TIME_HEADER = "X-Server-Time"
TIME_ZONE_HEADER = "X-Time-Zone"


def _resolve(request: Request, settings: Settings) -> datetime:
    # Like X-Dev-User, the override exists only in dev auth mode, which cannot run in production.
    override = request.headers.get(DEV_NOW_HEADER)
    if override is None or settings.auth_mode != "dev":
        return datetime.now(UTC)
    try:
        moment = datetime.fromisoformat(override)
    except ValueError as exc:
        raise ApiError(
            400, "invalid_dev_now", f"{DEV_NOW_HEADER} must be an ISO 8601 time"
        ) from exc
    if moment.tzinfo is None:
        raise ApiError(400, "invalid_dev_now", f"{DEV_NOW_HEADER} must include a UTC offset")
    return moment.astimezone(UTC)


def get_now(
    request: Request, response: Response, settings: Annotated[Settings, Depends(get_settings)]
) -> datetime:
    moment = _resolve(request, settings)
    response.headers[SERVER_TIME_HEADER] = moment.isoformat()
    return moment


Now = Annotated[datetime, Depends(get_now)]


def get_time_zone(request: Request) -> ZoneInfo:
    """The learner's time zone, sent by the browser. Only used to decide which calendar day it is
    (daily goal, streaks); an unknown or missing zone falls back to UTC rather than failing."""
    name = request.headers.get(TIME_ZONE_HEADER, "UTC")
    if len(name) > 64:  # untrusted input; real IANA names are short (zoneinfo rejects paths)
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


TimeZone = Annotated[ZoneInfo, Depends(get_time_zone)]


def get_sent_time_zone(request: Request) -> ZoneInfo | None:
    """The zone only if the browser really sent one, for keeping (ADR 0042): `get_time_zone`'s UTC
    fallback is fine for working out today, but saved it would send reminders at the wrong hour."""
    name = request.headers.get(TIME_ZONE_HEADER)
    if name is None or len(name) > 64:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


SentTimeZone = Annotated[ZoneInfo | None, Depends(get_sent_time_zone)]
