"""What is sent and when (ADR 0042): by each learner's own clock, at most twice a day, only what
they chose, and never a name."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PushSubscription, User
from app.services.reminders import send_reminders
from tests.support import at, finish

BISHKEK = "Asia/Bishkek"  # UTC+6, no clock changes
EVERY_DAY = list(range(7))
THURSDAY = datetime(2026, 11, 5, tzinfo=UTC)
WORDS = ["quill", "anvil", "lantern", "harbor", "compass", "saddle"]


class FakeSender:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    def send(self, subscription: PushSubscription, payload: str) -> bool:
        self.sent.append(json.loads(payload))
        return True


@pytest.fixture
def phone(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Any:
    """A learner who promised every day, with one phone, in a zone."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "vapid_public_key", "a-public-key")

    def make(name: str, zone: str | None, when: datetime = THURSDAY - timedelta(days=10)) -> None:
        headers = {"X-Dev-User": name, "X-Dev-Now": when.isoformat()}
        if zone:
            headers["X-Time-Zone"] = zone
        client.put("/api/me/promise", json={"weekdays": EVERY_DAY}, headers=headers)
        response = client.post(
            "/api/push/subscriptions",
            json={
                "endpoint": f"https://push.example.com/{name}",
                "keys": {"p256dh": "BKey", "auth": "auth"},
            },
            headers=headers,
        )
        assert response.status_code == 204, response.text

    return make


def utc(day: int, hour: int, minute: int = 5, month: int = 11) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=UTC)


def due(db: Session, moment: datetime) -> list[dict[str, str]]:
    sender = FakeSender()
    send_reminders(db, moment, sender)
    return sender.sent


def as_(name: str, moment: datetime, zone: str = BISHKEK) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment, zone)


def lesson(client: TestClient, name: str, moment: datetime, zone: str = BISHKEK) -> None:
    headers = as_(name, moment, zone)
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=headers
    ).json()
    finish(client, session, headers)
    done = client.post(f"/api/sessions/{session['id']}/complete", headers=headers)
    assert done.status_code == 200, done.text


# --- each learner's own clock -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("zone", "before", "at_eight"),
    [
        # 08:05 local, and the run an hour earlier is still 07:05.
        (BISHKEK, utc(5, 1), utc(5, 2)),
        ("Europe/Budapest", utc(5, 6), utc(5, 7)),  # UTC+1 in November
        ("America/New_York", utc(5, 12), utc(5, 13)),  # UTC-5 in November
        ("Pacific/Auckland", utc(4, 18), utc(4, 19)),  # UTC+13: already the next day there
    ],
)
def test_the_morning_comes_at_eight_on_each_learners_own_clock(
    db: Session, phone: Any, zone: str, before: datetime, at_eight: datetime
) -> None:
    phone("anna", zone)
    assert due(db, before) == []
    assert [item["title"] for item in due(db, at_eight)] == ["Сегодня день занятий"]


def test_half_hour_zones_are_not_an_hour_off(db: Session, phone: Any) -> None:
    phone("anna", "Asia/Kolkata")  # UTC+5:30
    assert due(db, utc(5, 2, 25)) == []  # 07:55 there
    assert len(due(db, utc(5, 2, 35))) == 1  # 08:05 there


def test_a_clock_change_moves_the_utc_hour_and_sends_once(db: Session, phone: Any) -> None:
    phone("anna", "America/New_York")
    # Saturday: still summer time, UTC-4, so eight o'clock is 12:00 UTC.
    assert len(due(db, utc(31, 12, month=10))) == 1
    # Sunday November 1: the clocks went back, UTC-5, so 12:05 UTC is 07:05 and 13:05 is 08:05.
    assert due(db, utc(1, 12)) == []
    assert len(due(db, utc(1, 13))) == 1
    assert due(db, utc(1, 14)) == []


def test_each_is_sent_once_with_room_to_catch_up_and_never_outside_its_hours(
    db: Session, phone: Any
) -> None:
    phone("anna", BISHKEK)
    assert due(db, utc(5, 1)) == []  # 07:05
    assert len(due(db, utc(5, 3, 30))) == 1  # 09:30: a late scheduler still counts
    assert due(db, utc(5, 3, 40)) == []  # only once
    assert due(db, utc(5, 4)) == []  # 10:05: too late for a morning

    assert due(db, utc(5, 10)) == []  # 16:05
    assert len(due(db, utc(5, 13, 30))) == 1  # 19:30
    assert due(db, utc(5, 13, 40)) == []
    assert due(db, utc(5, 14)) == []  # 20:05


def test_a_morning_missed_entirely_is_not_sent_late(db: Session, phone: Any) -> None:
    phone("anna", BISHKEK)
    assert [item["title"] for item in due(db, utc(5, 11))] == ["Сегодня ещё не занимались"]


def test_a_learner_whose_zone_is_unknown_gets_nothing(db: Session, phone: Any) -> None:
    phone("anna", None)
    assert db.scalars(select(User.time_zone)).one() is None
    for hour in range(24):
        assert due(db, utc(5, hour)) == []


def test_the_zone_is_kept_from_every_open_and_never_overwritten_by_a_missing_one(
    client: TestClient, db: Session
) -> None:
    def kept() -> str | None:
        db.expire_all()
        return db.scalars(select(User.time_zone)).one()

    client.get("/api/me", headers={"X-Dev-User": "anna", "X-Time-Zone": BISHKEK})
    assert kept() == BISHKEK
    for headers in ({}, {"X-Time-Zone": "Not/AZone"}):
        assert client.get("/api/me", headers={"X-Dev-User": "anna"} | headers).status_code == 200
        started = client.post(
            "/api/sessions",
            json={"kind": "study", "deck_id": "a1-a2"},
            headers={"X-Dev-User": "anna"} | headers,
        )
        assert started.status_code == 200
        assert kept() == BISHKEK
    # Travelling: opening the app brings the new zone.
    client.get("/api/me", headers={"X-Dev-User": "anna", "X-Time-Zone": "Europe/Budapest"})
    assert kept() == "Europe/Budapest"


# --- what the morning says --------------------------------------------------------------------


def test_a_rest_day_alone_is_silent(client: TestClient, db: Session, phone: Any) -> None:
    phone("anna", BISHKEK)
    client.put("/api/me/promise", json={"weekdays": [0]}, headers=as_("anna", THURSDAY))
    # The change starts tomorrow only after a lesson; none yet, so today is already off.
    assert due(db, utc(5, 2)) == []
    assert due(db, utc(5, 11)) == []


def test_a_paused_promise_sends_nothing(client: TestClient, db: Session, phone: Any) -> None:
    phone("anna", BISHKEK)
    client.put(
        "/api/me/promise/pause", json={"until": "2026-11-10"}, headers=as_("anna", utc(4, 6))
    )
    assert due(db, utc(5, 2)) == []


def test_nothing_at_five_once_today_is_done(client: TestClient, db: Session, phone: Any) -> None:
    phone("anna", BISHKEK)
    lesson(client, "anna", utc(5, 5))
    assert due(db, utc(5, 11)) == []


def a_group(client: TestClient, zone: str = BISHKEK) -> dict[str, Any]:
    """Olga's group, joined a week before, with Pavel and Ivan who promise every day."""
    joined = THURSDAY - timedelta(days=7)
    group: dict[str, Any] = client.post(
        "/api/groups", json={"name": "7Б", "nickname": "Ольга"}, headers=as_("olga", joined, zone)
    ).json()
    for user, nickname in (("pavel", "Павел"), ("ivan", "Иван")):
        client.post(
            f"/api/groups/join/{group['invite_code']}",
            json={"nickname": nickname},
            headers=as_(user, joined, zone),
        )
    for user in ("olga", "pavel", "ivan"):
        client.put("/api/me/promise", json={"weekdays": EVERY_DAY}, headers=as_(user, joined, zone))
    return group


def test_the_daily_report_counts_yesterday_and_names_nobody(
    client: TestClient, db: Session, phone: Any
) -> None:
    a_group(client)
    phone("olga", BISHKEK)
    lesson(client, "pavel", utc(4, 6))  # Wednesday, by the group's clock
    (morning,) = due(db, utc(5, 2))
    assert "Вчера в «7Б»: 1 из 3 сдержали обещание." in morning["body"]
    everything = json.dumps(morning, ensure_ascii=False)
    for name in ("Ольга", "Павел", "Иван"):
        assert name not in everything


def test_monday_reports_on_sunday(client: TestClient, db: Session, phone: Any) -> None:
    a_group(client)
    phone("olga", BISHKEK)
    lesson(client, "ivan", utc(8, 6))  # Sunday November 8
    (morning,) = due(db, utc(9, 2))  # Monday
    assert "Вчера в «7Б»: 1 из 3" in morning["body"]


def test_the_report_is_the_groups_last_finished_day_never_one_under_way(
    client: TestClient, db: Session, phone: Any
) -> None:
    """A group in New York, a learner in Bishkek: at 08:05 on Thursday it is still Wednesday
    evening there. Wednesday isn't over, so the report is Tuesday, by date, as it isn't the
    learner's yesterday."""
    new_york = "America/New_York"
    a_group(client, new_york)
    phone("olga", BISHKEK)
    lesson(client, "pavel", utc(3, 18), new_york)  # Tuesday afternoon in New York
    lesson(client, "ivan", utc(5, 1), new_york)  # Wednesday evening there: not finished yet
    (morning,) = due(db, utc(5, 2))
    assert "3 ноября в «7Б»: 1 из 3" in morning["body"]
    assert "Вчера" not in morning["body"]


def test_the_day_someone_joined_does_not_count_against_them(
    client: TestClient, db: Session, phone: Any
) -> None:
    group = a_group(client)
    phone("olga", BISHKEK)
    client.post(
        f"/api/groups/join/{group['invite_code']}",
        json={"nickname": "Новый"},
        headers=as_("newcomer", utc(4, 6)),
    )
    (morning,) = due(db, utc(5, 2))
    assert "0 из 3" in morning["body"]


def a_deck_due_today(client: TestClient, zone: str = BISHKEK) -> dict[str, Any]:
    """Olga gave her group a deck due today, Thursday."""
    group = a_group(client, zone)
    earlier = THURSDAY - timedelta(days=5)
    deck: dict[str, Any] = client.post(
        "/api/decks", json={"title": "Unit 4"}, headers=as_("olga", earlier)
    ).json()
    for word in WORDS:
        client.post(
            f"/api/decks/{deck['id']}/words",
            json={"headword": word, "pos": "noun", "translation": "слово", "example": f"A {word}."},
            headers=as_("olga", earlier),
        )
    given = client.post(
        f"/api/decks/{deck['id']}/publish",
        json={"group_id": group["id"], "due_on": "2026-11-05"},
        headers=as_("olga", earlier),
    )
    assert given.status_code == 200, given.text
    return deck


def test_on_the_deadline_day_a_member_hears_where_they_stand(
    client: TestClient, db: Session, phone: Any
) -> None:
    a_deck_due_today(client)
    phone("pavel", BISHKEK)
    (morning,) = due(db, utc(5, 2))
    assert "Сегодня срок «Unit 4»: осталось 6\u00a0слов." in morning["body"]


def test_on_the_deadline_day_a_member_who_finished_is_told_so(
    client: TestClient, db: Session, phone: Any
) -> None:
    deck = a_deck_due_today(client)
    phone("pavel", BISHKEK)
    headers = as_("pavel", utc(4, 6))
    client.put(f"/api/decks/{deck['id']}/pace", json={"daily_new": 10}, headers=headers)
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck["id"]}, headers=headers
    ).json()
    finish(client, session, headers)
    client.post(f"/api/sessions/{session['id']}/complete", headers=headers)
    (morning,) = due(db, utc(5, 2))
    assert "Сегодня срок «Unit 4»: вы готовы." in morning["body"]


def test_on_the_deadline_day_its_author_hears_nothing_of_who_is_ready(
    client: TestClient, db: Session, phone: Any
) -> None:
    a_deck_due_today(client)
    phone("olga", BISHKEK)
    (morning,) = due(db, utc(5, 2))
    assert "Сегодня срок «Unit 4»." in morning["body"]
    assert "Готовы" not in morning["body"]


# --- choosing ---------------------------------------------------------------------------------


def choose(client: TestClient, name: str, **choices: bool) -> None:
    response = client.patch("/api/me", json=choices, headers=as_(name, THURSDAY))
    assert response.status_code == 200, response.text
    for choice, value in choices.items():
        assert response.json()[choice] is value


def test_everything_is_on_until_chosen_otherwise(client: TestClient) -> None:
    me = client.get("/api/me").json()
    assert all(
        me[choice]
        for choice in ("notify_morning", "notify_afternoon", "notify_report", "notify_deadline")
    )


def test_a_choice_turned_off_takes_only_its_own_part(
    client: TestClient, db: Session, phone: Any
) -> None:
    a_deck_due_today(client)
    phone("pavel", BISHKEK)
    choose(client, "pavel", notify_report=False)
    (morning,) = due(db, utc(5, 2))
    assert "сдержали" not in morning["body"] and "Сегодня срок" in morning["body"]


def test_without_the_morning_reminder_the_report_comes_alone(
    client: TestClient, db: Session, phone: Any
) -> None:
    a_group(client)
    phone("pavel", BISHKEK)
    choose(client, "pavel", notify_morning=False)
    (morning,) = due(db, utc(5, 2))
    assert morning["title"] == "Отчёт группы"
    assert "Вчера в «7Б»" in morning["body"]


def test_without_the_deadline_report_there_is_no_deadline_line(
    client: TestClient, db: Session, phone: Any
) -> None:
    a_deck_due_today(client)
    phone("pavel", BISHKEK)
    choose(client, "pavel", notify_deadline=False, notify_report=False, notify_morning=False)
    assert due(db, utc(5, 2)) == []


def test_the_five_oclock_one_can_be_turned_off_alone(
    client: TestClient, db: Session, phone: Any
) -> None:
    phone("anna", BISHKEK)
    choose(client, "anna", notify_afternoon=False)
    assert len(due(db, utc(5, 2))) == 1
    assert due(db, utc(5, 11)) == []


def test_with_everything_off_nothing_comes_and_the_phone_stays_subscribed(
    client: TestClient, db: Session, phone: Any
) -> None:
    a_deck_due_today(client)
    phone("pavel", BISHKEK)
    choose(
        client,
        "pavel",
        notify_morning=False,
        notify_afternoon=False,
        notify_report=False,
        notify_deadline=False,
    )
    for hour in range(24):
        assert due(db, utc(5, hour)) == []
    assert db.scalars(select(PushSubscription.endpoint)).all()


# --- stopping and carrying on -----------------------------------------------------------------


def test_stopping_at_the_time_limit_carries_on_without_sending_twice(
    db: Session, phone: Any
) -> None:
    for name in ("anna", "boris", "vera"):
        phone(name, BISHKEK)
    sender = FakeSender()
    first = send_reminders(db, utc(5, 2), sender, max_seconds=-1)
    assert (first.sent, first.finished) == (0, False)
    assert sender.sent == []
    second = send_reminders(db, utc(5, 3), sender)
    assert (second.sent, second.finished) == (3, True)
    third = send_reminders(db, utc(5, 3, 30), sender)
    assert (third.sent, third.finished) == (0, True)
    assert len(sender.sent) == 3


@pytest.mark.parametrize(
    ("language", "expected"),
    [
        ("ky", "Бүгүн «Unit 4» мөөнөтү: 6 сөз калды."),
        ("kk", "Бүгін «Unit 4» мерзімі: 6 сөз қалды."),
        ("tg", "Имрӯз мӯҳлати «Unit 4»: 6 калима монд."),
        ("uz", "Bugun «Unit 4» muddati: 6 ta so‘z qoldi."),
        ("en", "“Unit 4” is due today: 6 words left."),
    ],
)
def test_a_notification_comes_in_the_learners_own_language(
    client: TestClient, db: Session, phone: Any, language: str, expected: str
) -> None:
    a_deck_due_today(client)
    phone("pavel", BISHKEK)
    response = client.patch(
        "/api/me", json={"ui_language": language}, headers=as_("pavel", THURSDAY)
    )
    assert response.status_code == 200
    (morning,) = due(db, utc(5, 2))
    assert expected in morning["body"]
    assert morning["lang"] == language
