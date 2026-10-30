"""Deadline reminders on the phone (ADR 0031): one in the evening, only with words due for a
deadline; devices subscribe and unsubscribe; the scheduler needs the shared secret."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.push import get_sender
from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import PushSubscription, User
from app.services.reminders import reminder_for, send_reminders, vapid_keys
from tests.support import at, cards, finish

THURSDAY = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
EVENING = THURSDAY.replace(hour=18, minute=30)
TOKEN = "tick-tock"  # noqa: S105 - a test's stand-in secret
WORDS = ["quill", "anvil", "lantern", "harbor", "compass", "saddle"]
DEVICE = {
    "endpoint": "https://push.example.com/send/abc",
    "keys": {"p256dh": "BPublicKeyOfTheBrowser", "auth": "secret16bytes"},
    "expirationTime": None,
}


class FakeSender:
    def __init__(self, gone: frozenset[str] = frozenset()) -> None:
        self.sent: list[tuple[str, str]] = []
        self.gone = gone

    def send(self, subscription: PushSubscription, payload: str) -> bool:
        if subscription.endpoint in self.gone:
            return False
        self.sent.append((subscription.endpoint, payload))
        return True


def as_(name: str, moment: datetime = THURSDAY) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


@pytest.fixture
def push_client(db: Session) -> Iterator[TestClient]:
    keys = vapid_keys()
    settings = Settings(
        environment="test",
        database_url=get_settings().database_url,
        vapid_public_key=keys["VAPID_PUBLIC_KEY"],
        vapid_private_key=keys["VAPID_PRIVATE_KEY"],
        reminders_token=TOKEN,
        _env_file=None,
    )
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client


def a_class_with_a_deadline(client: TestClient) -> dict[str, Any]:
    """Olga gives Pavel six words on Thursday, due Saturday: three today, three tomorrow."""
    group = client.post(
        "/api/groups", json={"name": "7Б", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}", json={"nickname": "Павел"}, headers=as_("pavel")
    )
    deck: dict[str, Any] = client.post(
        "/api/decks", json={"title": "Морское дело"}, headers=as_("olga")
    ).json()
    for word in WORDS:
        client.post(
            f"/api/decks/{deck['id']}/words",
            json={"headword": word, "pos": "noun", "translation": "слово", "example": "An x."},
            headers=as_("olga"),
        )
    client.post(
        f"/api/decks/{deck['id']}/publish",
        json={"group_id": group["id"], "due_on": "2026-11-07"},
        headers=as_("olga"),
    )
    client.put(f"/api/decks/{deck['id']}/pace", json={"daily_new": 1}, headers=as_("pavel"))
    return deck


def pavel(db: Session) -> User:
    return db.scalars(select(User).where(User.auth_subject == "dev|pavel")).one()


def test_a_device_subscribes_and_unsubscribes(push_client: TestClient, db: Session) -> None:
    key = push_client.get("/api/push/key").json()["public_key"]
    assert key and len(key) == 87  # a P-256 point, base64url
    assert (
        push_client.post("/api/push/subscriptions", json=DEVICE, headers=as_("pavel")).status_code
        == 204
    )
    # The same device again, now for another learner: one learner per device.
    push_client.post("/api/push/subscriptions", json=DEVICE, headers=as_("anna"))
    rows = db.scalars(select(PushSubscription)).all()
    assert len(rows) == 1 and rows[0].user_id != pavel(db).id
    plain_http = DEVICE | {"endpoint": "http://push.example.com/x"}
    assert (
        push_client.post(
            "/api/push/subscriptions", json=plain_http, headers=as_("anna")
        ).status_code
        == 422
    )
    body = {"endpoint": DEVICE["endpoint"]}
    assert (
        push_client.request(
            "DELETE", "/api/push/subscriptions", json=body, headers=as_("anna")
        ).status_code
        == 204
    )
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 0


def test_without_keys_there_are_no_reminders(db: Session) -> None:
    settings = Settings(
        environment="test", database_url=get_settings().database_url, _env_file=None
    )
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        assert client.get("/api/push/key").json() == {"public_key": None}
        response = client.post("/api/push/subscriptions", json=DEVICE, headers=as_("pavel"))
        assert (response.status_code, response.json()["error"]["code"]) == (
            503,
            "reminders_unavailable",
        )


def test_the_reminder_names_today_s_words_for_the_deadline(
    push_client: TestClient, db: Session
) -> None:
    a_class_with_a_deadline(push_client)
    reminder = reminder_for(db, pavel(db), EVENING)
    assert reminder is not None
    assert (reminder.title, reminder.body) == (
        "Слова к уроку",
        "Сегодня 3 слова по «Морское дело», чтобы успеть к 7 ноября.",
    )


def test_one_evening_reminder_a_day_and_none_when_today_is_done(
    push_client: TestClient, db: Session
) -> None:
    deck = a_class_with_a_deadline(push_client)
    push_client.post("/api/push/subscriptions", json=DEVICE, headers=as_("pavel"))
    old_phone = "https://push.example.com/send/old-phone"
    push_client.post(
        "/api/push/subscriptions", json=DEVICE | {"endpoint": old_phone}, headers=as_("pavel")
    )
    sender = FakeSender(gone=frozenset({old_phone}))

    assert send_reminders(db, THURSDAY.replace(hour=15), sender) == 0  # not evening yet
    assert send_reminders(db, EVENING, sender) == 1
    assert [endpoint for endpoint, _ in sender.sent] == [DEVICE["endpoint"]]
    assert '"title": "Слова к уроку"' in sender.sent[0][1]
    # The old phone is gone for good; the next hour sends nothing again.
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 1
    assert send_reminders(db, EVENING + timedelta(hours=1), sender) == 0

    # Friday: Pavel learns the day's words before the evening, so no reminder.
    friday = THURSDAY + timedelta(days=1)
    session = push_client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck["id"]}, headers=as_("pavel", friday)
    ).json()
    assert len([card for card in cards(session) if card["new"]]) == 6  # all six: due tomorrow
    finish(push_client, session, as_("pavel", friday))
    push_client.post(f"/api/sessions/{session['id']}/complete", headers=as_("pavel", friday))
    assert send_reminders(db, friday.replace(hour=19), sender) == 0


def test_the_scheduler_needs_the_secret(push_client: TestClient) -> None:
    sender = FakeSender()
    app = push_client.app
    assert hasattr(app, "dependency_overrides")
    app.dependency_overrides[get_sender] = lambda: sender
    url = "/api/internal/reminders"
    assert push_client.post(url).status_code == 404
    assert push_client.post(url, headers={"X-Reminders-Token": "guess"}).status_code == 404
    response = push_client.post(url, headers={"X-Reminders-Token": TOKEN} | at(EVENING))
    assert response.json() == {"sent": 0}  # nobody subscribed


def test_deleting_the_account_forgets_its_devices(push_client: TestClient, db: Session) -> None:
    push_client.post("/api/push/subscriptions", json=DEVICE, headers=as_("pavel"))
    push_client.delete("/api/me", headers=as_("pavel"))
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 0
