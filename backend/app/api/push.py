"""Deadline reminders on the learner's phone by Web Push (ADR 0031)."""

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.services import reminders

router = APIRouter(tags=["push"])


class PushKeysIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p256dh: Annotated[str, Field(min_length=1, max_length=128)]
    auth: Annotated[str, Field(min_length=1, max_length=64)]


class SubscriptionIn(BaseModel):
    """A browser's PushSubscription, as `subscription.toJSON()` gives it."""

    model_config = ConfigDict(extra="ignore")

    endpoint: Annotated[str, Field(pattern=r"^https://", max_length=1024)]
    keys: PushKeysIn


class EndpointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: Annotated[str, Field(max_length=1024)]


class PushKeyOut(BaseModel):
    # The server's VAPID public key for `pushManager.subscribe`; null: reminders are off here.
    public_key: str | None


class SentOut(BaseModel):
    sent: int


SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/push/key")
def push_key(settings: SettingsDep) -> PushKeyOut:
    return PushKeyOut(public_key=settings.vapid_public_key)


@router.post("/push/subscriptions", status_code=204)
def subscribe(
    body: SubscriptionIn, user: CurrentUser, db: DbSession, now: Now, settings: SettingsDep
) -> Response:
    """This device gets deadline reminders (ADR 0031)."""
    if not settings.vapid_public_key:
        raise ApiError(503, "reminders_unavailable", "Reminders are not set up on this server")
    reminders.subscribe(db, user, body.endpoint, body.keys.p256dh, body.keys.auth, now)
    return Response(status_code=204)


@router.delete("/push/subscriptions", status_code=204)
def unsubscribe(body: EndpointIn, user: CurrentUser, db: DbSession) -> Response:
    reminders.unsubscribe(db, user, body.endpoint)
    return Response(status_code=204)


def require_reminders_token(
    settings: SettingsDep,
    token: Annotated[str | None, Header(alias="X-Reminders-Token")] = None,
) -> None:
    """Only the scheduler, with the shared secret; to anyone else the endpoint does not exist."""
    if not settings.reminders_token or not secrets.compare_digest(
        token or "", settings.reminders_token
    ):
        raise ApiError(404, "not_found", "Not Found")


def get_sender(settings: SettingsDep) -> reminders.Sender:
    if not settings.vapid_private_key:
        raise ApiError(503, "reminders_unavailable", "Reminders are not set up on this server")
    return reminders.WebPushSender(settings)


@router.post("/internal/reminders", dependencies=[Depends(require_reminders_token)])
def send_reminders(
    db: DbSession, now: Now, sender: Annotated[reminders.Sender, Depends(get_sender)]
) -> SentOut:
    """Called every hour by a scheduler with the shared secret: sends the evening's reminders."""
    return SentOut(sent=reminders.send_reminders(db, now, sender))
