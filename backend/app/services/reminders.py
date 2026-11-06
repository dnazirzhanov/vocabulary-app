"""Notifications on the learner's phone (ADR 0031, 0042), at most two a day, by their own clock.

In the morning, one notification with what the learner chose of: today's promise, their group's
last finished day, and a deck due today. At 17:00, one only if today is still open. Counts only,
never names: a lock screen can be read by anyone. With nothing to say, nothing is sent.

Notifications go by Web Push: the browser's push service delivers them, so there is no account
to keep and no e-mail. A scheduler calls `send_reminders` every hour (POST
/api/internal/reminders, or the CLI). The server works in UTC and turns it into each learner's
local time on every run, so daylight saving and half-hour zones need nothing special; a learner
whose zone isn't known gets nothing rather than something at the wrong hour.
"""

import json
import time
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid.utils import b64urlencode
from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.locale import DEFAULT, Texts, texts_for
from app.core.logging import logger
from app.models import DeckAssignment, Group, GroupMember, PushSubscription, User
from app.services import decks, pace
from app.services.progress import local_day_bounds
from app.services.promise import load_promises, promise_of, today_state
from app.services.scheduling import local_date
from app.services.study_days import days_by_user

# Local hours, [from, before): a free scheduler can run late, so each has room to catch up.
MORNING = (8, 10)
AFTERNOON = (17, 20)
# Stops in time for a free host's request limit; the next run carries on where this one stopped.
MAX_SECONDS = 50.0
# A notification still unread after this long is no use: the push service drops it.
TTL_SECONDS = 4 * 60 * 60
# A push service may not know a brand-new subscription for a moment: not gone yet.
SETTLING = timedelta(hours=1)


@dataclass(frozen=True)
class Reminder:
    title: str
    body: str


def _words_due(
    db: Session, user: User, now: datetime, zone: ZoneInfo
) -> list[tuple[str, int, date]]:
    """Today's words in decks with a deadline still ahead (or today): (title, words, deadline)."""
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
    return due


def _words_line(texts: Texts, due: list[tuple[str, int, date]], today: date) -> str:
    if len(due) == 1:
        title, count, due_on = due[0]
        if due_on == today:
            return texts.left_in_deck(texts.words(count), title)
        return texts.today_for_deadline(texts.words(count), title, texts.day(due_on))
    titles = ", ".join(texts.quoted(title) for title, _, _ in due)
    return texts.today_in_decks(texts.words(sum(count for _, count, _ in due)), titles)


def _memberships(db: Session, user: User) -> list[tuple[Group, GroupMember]]:
    rows = db.execute(
        select(Group, GroupMember)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
        .order_by(GroupMember.joined_at, Group.id)
    ).all()
    return [(group, member) for group, member in rows]


def _group_report(
    db: Session, texts: Texts, group: Group, now: datetime, my_yesterday: date
) -> str | None:
    """The group's last finished day, in the group's own zone (ADR 0039): a count, or None when
    nobody had promised it. Named by date if that isn't this reader's yesterday."""
    zone = ZoneInfo(group.time_zone)
    day = local_date(now, zone) - timedelta(days=1)
    rows = db.execute(
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group.id)
    ).all()
    users = [user for _, user in rows]
    promises = load_promises(db, users)
    studied = days_by_user(db, users, local_day_bounds(day, zone)[0], zone)
    # The day after joining is the first that counts.
    counted = [
        user
        for member, user in rows
        if local_date(member.joined_at, zone) < day and promises[user.id].promised_on(day)
    ]
    if not counted:
        return None
    done = sum(today_state(promises[user.id], studied[user.id], day) == "done" for user in counted)
    if day == my_yesterday:
        return texts.report_yesterday(group.name, done, len(counted))
    return texts.report_on(texts.day(day), group.name, done, len(counted))


def _deadline_reports(
    db: Session, texts: Texts, user: User, now: datetime, today: date
) -> list[str]:
    """Decks due today, and where the learner stands: their own words, nobody else's (ADR 0054)."""
    lines: list[str] = []
    for group, me in _memberships(db, user):
        due_today = db.scalar(
            select(DeckAssignment.id)
            .where(
                DeckAssignment.group_id == group.id,
                DeckAssignment.due_on == today,
                DeckAssignment.removed_at.is_(None),
            )
            .limit(1)
        )
        if due_today is None:
            continue
        zone = ZoneInfo(group.time_zone)
        members = list(db.scalars(select(GroupMember).where(GroupMember.group_id == group.id)))
        for given in decks.board_assignments(
            db, group.id, me, members, local_date(now, zone), zone
        ):
            if given.due_on != today:
                continue
            if given.is_mine or given.my_standing is None:
                lines.append(texts.deadline_today(given.title))
            elif given.my_standing.behind == 0:
                lines.append(texts.deadline_ready(given.title))
            else:
                lines.append(
                    texts.deadline_left(given.title, texts.words(given.my_standing.behind))
                )
    return lines


def _state_today(db: Session, user: User, now: datetime, zone: ZoneInfo, today: date) -> str:
    studied = days_by_user(db, [user], local_day_bounds(today, zone)[0], zone)[user.id]
    return today_state(promise_of(db, user), studied, today)


def morning_message(db: Session, user: User, now: datetime, zone: ZoneInfo) -> Reminder | None:
    """One notification with what the learner chose, or None with nothing to say."""
    texts = texts_for(user.ui_language)
    today = local_date(now, zone)
    promised = user.notify_morning and _state_today(db, user, now, zone, today) == "pending"
    deadlines = _deadline_reports(db, texts, user, now, today) if user.notify_deadline else []
    words = (
        [item for item in _words_due(db, user, now, zone) if item[2] != today]
        if user.notify_deadline
        else []
    )
    reports = (
        [
            line
            for group, _ in _memberships(db, user)[:1]
            if (line := _group_report(db, texts, group, now, today - timedelta(days=1)))
        ]
        if user.notify_report
        else []
    )
    lines = [*deadlines, *([_words_line(texts, words, today)] if words else []), *reports]
    if promised:
        return Reminder(texts.study_day, " ".join(lines) or texts.lesson_waits)
    if deadlines:
        return Reminder(texts.deadline_title, " ".join(lines))
    if words:
        return Reminder(texts.words_title, " ".join(lines))
    if reports:
        return Reminder(texts.report_title, " ".join(lines))
    return None


def afternoon_message(db: Session, user: User, now: datetime, zone: ZoneInfo) -> Reminder | None:
    """Only if today is still open: the promise not done yet, or words left for a deadline."""
    if not user.notify_afternoon:
        return None
    texts = texts_for(user.ui_language)
    today = local_date(now, zone)
    words = _words_due(db, user, now, zone) if user.notify_deadline else []
    line = _words_line(texts, words, today) if words else None
    if _state_today(db, user, now, zone, today) == "pending":
        return Reminder(texts.not_yet_title, line or texts.still_time)
    if not line:
        return None
    return Reminder(texts.deadline_title if words[0][2] == today else texts.words_title, line)


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


@dataclass(frozen=True)
class Sent:
    sent: int
    finished: bool


def send_reminders(
    db: Session, now: datetime, sender: Sender, max_seconds: float = MAX_SECONDS
) -> Sent:
    """Whatever each learner is due by their own clock, once per local date. Gone subscriptions
    are forgotten; a failed send is tried next hour. Saved learner by learner, so stopping or
    failing halfway never sends anything twice."""
    started = time.monotonic()
    rows: Sequence[tuple[PushSubscription, User]] = db.execute(
        select(PushSubscription, User)
        .join(User, User.id == PushSubscription.user_id)
        .where(User.time_zone.is_not(None))
        .order_by(User.id)
    ).all()
    by_user: dict[UUID, list[PushSubscription]] = defaultdict(list)
    users: dict[UUID, User] = {}
    for subscription, user in rows:
        by_user[user.id].append(subscription)
        users[user.id] = user
    sent = 0
    for user_id, subscriptions in by_user.items():
        user = users[user_id]
        assert user.time_zone is not None
        zone = ZoneInfo(user.time_zone)
        local = now.astimezone(zone)
        today = local.date()
        if MORNING[0] <= local.hour < MORNING[1]:
            field, make = "last_morning_on", morning_message
        elif AFTERNOON[0] <= local.hour < AFTERNOON[1]:
            field, make = "last_sent_on", afternoon_message
        else:
            continue
        waiting = [item for item in subscriptions if getattr(item, field) != today]
        if not waiting:
            continue
        if time.monotonic() - started > max_seconds:
            return Sent(sent, finished=False)
        reminder = make(db, user, now, zone)
        if reminder is None:
            continue
        payload = json.dumps(
            {
                "title": reminder.title,
                "body": reminder.body,
                "url": "/",
                "lang": user.ui_language or DEFAULT,
            },
            ensure_ascii=False,
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
                setattr(subscription, field, today)
                sent += 1
            elif now - subscription.created_at > SETTLING:
                db.delete(subscription)
        db.commit()
    return Sent(sent, finished=True)


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
