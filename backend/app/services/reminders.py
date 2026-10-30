"""Deadline reminders on the learner's phone (ADR 0031).

A learner who turns reminders on gets at most one notification a day, in the evening of their
own day, and only when a deck with a teacher's deadline (ADR 0028) still has words for today:
«Сегодня 4 слова по «Unit 5», чтобы успеть к 7 ноября». Nothing on other days: a reminder that
comes every evening is soon ignored.

Notifications go by Web Push: the browser's push service delivers them, so there is no account
to keep and no e-mail. A scheduler calls `send_reminders` every hour (POST
/api/internal/reminders, or the CLI); each learner is reminded once, between 18:00 and 22:00.
"""

import json
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol
from uuid import UUID

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid.utils import b64urlencode
from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.logging import logger
from app.models import PushSubscription, User
from app.services import decks, pace
from app.services.scheduling import local_date
from app.services.study_days import zone_of

# The evening, in the learner's own time: from 18:00 to before 22:00.
FIRST_HOUR = 18
LAST_HOUR = 21
# A reminder still unread after this long is no use: the push service drops it.
TTL_SECONDS = 4 * 60 * 60
# A push service may not know a brand-new subscription for a moment: not gone yet.
SETTLING = timedelta(hours=1)


@dataclass(frozen=True)
class Reminder:
    title: str
    body: str


def _words(n: int) -> str:
    last, tens = n % 10, n % 100
    form = (
        "слово"
        if last == 1 and tens != 11
        else "слова"
        if 2 <= last <= 4 and not 12 <= tens <= 14
        else "слов"
    )
    return f"{n} {form}"


def _day(day: date) -> str:
    months = [
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
    ]
    return f"{day.day} {months[day.month - 1]}"


def reminder_for(db: Session, user: User, now: datetime) -> Reminder | None:
    """Today's words in decks with a deadline still ahead (or today), or None."""
    zone = zone_of(user)
    today = local_date(now, zone)
    due: list[tuple[str, int, date]] = []
    for given in decks.assigned_decks(db, user):
        if given.due_on is None or given.due_on < today:
            continue
        plan = pace.day_plan(db, user, given.deck.id, now, zone)
        if plan.remaining > 0 and not plan.blocked_by_reviews:
            left = min(plan.remaining, pace.deck_left(db, user, given.deck))
            if left > 0:
                due.append((given.deck.title, left, given.due_on))
    if not due:
        return None
    if len(due) == 1:
        title, count, due_on = due[0]
        if due_on == today:
            return Reminder("Срок — сегодня", f"Осталось {_words(count)} в «{title}».")
        return Reminder(
            "Слова к уроку", f"Сегодня {_words(count)} по «{title}», чтобы успеть к {_day(due_on)}."
        )
    titles = ", ".join(f"«{title}»" for title, _, _ in due)
    return Reminder("Слова к урокам", f"Сегодня {_words(sum(c for _, c, _ in due))}: {titles}.")


class Sender(Protocol):
    def send(self, subscription: PushSubscription, payload: str) -> bool:
        """Delivers it; False when the push service says the subscription is gone."""
        ...


class WebPushSender:
    def __init__(self, settings: Settings) -> None:
        if not settings.vapid_private_key:
            raise ValueError("Reminders need VAPID_PRIVATE_KEY")
        self._key = settings.vapid_private_key
        self._subject = settings.vapid_subject

    def send(self, subscription: PushSubscription, payload: str) -> bool:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=payload,
                vapid_private_key=self._key,
                vapid_claims={"sub": self._subject},
                ttl=TTL_SECONDS,
                timeout=10,
            )
        except WebPushException as error:
            status = getattr(error.response, "status_code", None)
            if status in (404, 410):
                return False
            raise
        return True


def send_reminders(db: Session, now: datetime, sender: Sender) -> int:
    """One evening reminder per learner who has words due for a deadline; returns how many
    devices were sent one. Gone subscriptions are forgotten; a failed send is tried next hour."""
    rows: Sequence[tuple[PushSubscription, User]] = db.execute(
        select(PushSubscription, User).join(User, User.id == PushSubscription.user_id)
    ).all()
    by_user: dict[UUID, list[PushSubscription]] = defaultdict(list)
    users: dict[UUID, User] = {}
    for subscription, user in rows:
        by_user[user.id].append(subscription)
        users[user.id] = user
    sent = 0
    for user_id, subscriptions in by_user.items():
        user = users[user_id]
        local = now.astimezone(zone_of(user))
        today = local.date()
        if not FIRST_HOUR <= local.hour <= LAST_HOUR:
            continue
        waiting = [item for item in subscriptions if item.last_sent_on != today]
        if not waiting:
            continue
        reminder = reminder_for(db, user, now)
        if reminder is None:
            continue
        payload = json.dumps(
            {"title": reminder.title, "body": reminder.body, "url": "/"}, ensure_ascii=False
        )
        for subscription in waiting:
            try:
                delivered = sender.send(subscription, payload)
            except Exception as error:  # a push service down: try again next hour
                logger.warning(
                    "reminder not sent", extra={"fields": {"error": type(error).__name__}}
                )
                continue
            if delivered:
                subscription.last_sent_on = today
                sent += 1
            elif now - subscription.created_at > SETTLING:
                db.delete(subscription)
    db.commit()
    return sent


def subscribe(
    db: Session, user: User, endpoint: str, p256dh: str, auth: str, now: datetime
) -> None:
    """This device gets reminders for this learner (one learner per device: the last to turn
    them on)."""
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if existing is None:
        db.add(
            PushSubscription(
                user_id=user.id, endpoint=endpoint, p256dh=p256dh, auth=auth, created_at=now
            )
        )
    else:
        existing.user_id, existing.p256dh, existing.auth = user.id, p256dh, auth
    db.commit()


def unsubscribe(db: Session, user: User, endpoint: str) -> None:
    subscription = db.scalar(
        select(PushSubscription).where(
            PushSubscription.endpoint == endpoint, PushSubscription.user_id == user.id
        )
    )
    if subscription is not None:
        db.delete(subscription)
        db.commit()


def vapid_keys() -> dict[str, str]:
    """A new VAPID key pair: the private key as 32 raw bytes and the public key as the
    uncompressed point browsers take as `applicationServerKey`, both base64url."""
    key = ec.generate_private_key(ec.SECP256R1())
    raw = key.private_numbers().private_value.to_bytes(32, "big")
    point = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return {"VAPID_PUBLIC_KEY": b64urlencode(point), "VAPID_PRIVATE_KEY": b64urlencode(raw)}
