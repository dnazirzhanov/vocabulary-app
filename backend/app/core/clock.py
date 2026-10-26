"""The current time, as one dependency, so reviews can be tested without waiting days.

Responses carry the server's time (X-Server-Time). The web app counts "tomorrow" and "in 3 days"
from it instead of the device clock, which is often wrong on phones.
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request, Response

from app.core.config import Settings, get_settings
from app.core.errors import ApiError

DEV_NOW_HEADER = "X-Dev-Now"
SERVER_TIME_HEADER = "X-Server-Time"


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
