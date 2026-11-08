"""Sync of personal decks and settings (ADR 0061): changes made offline arrive once, in order,
without overwriting what changed elsewhere, and never reach anyone else's data."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SyncOp, SyncTombstone
from app.services import decks, sync
from tests.support import at

NOW = datetime(2026, 11, 8, 9, 0, tzinfo=UTC)


def as_(user: str, moment: datetime = NOW) -> dict[str, str]:
    return {"X-Dev-User": user} | at(moment)


def deck_id() -> str:
    return f"g-{uuid4()}"


def word_id() -> str:
    return f"t-{uuid4()}"


def card(headword: str, translation: str = "перевод") -> dict[str, str]:
    return {
        "headword": headword,
        "pos": "noun",
        "translation": translation,
        "example": f"A {headword}.",
    }


def op(kind: str, **fields: Any) -> dict[str, Any]:
    return {"op_id": str(uuid4()), "kind": kind, **fields}


def push(
    client: TestClient, ops: list[dict[str, Any]], user: str = "pavel", pulled_at: datetime = NOW
) -> Any:
    response = client.post(
        "/api/sync/push", json={"ops": ops, "pulled_at": pulled_at.isoformat()}, headers=as_(user)
    )
    assert response.status_code == 200, response.text
    return [(result["status"], result) for result in response.json()["results"]]


def pull(
    client: TestClient, user: str = "pavel", cursor: int = 0, pulled_at: datetime = NOW
) -> Any:
    params: dict[str, str | int] = {"cursor": cursor, "pulled_at": pulled_at.isoformat()}
    response = client.get("/api/sync/decks", params=params, headers=as_(user))
    assert response.status_code == 200, response.text
    return response.json()


def offline_deck(cards: int = 20) -> tuple[str, list[str], list[dict[str, Any]]]:
    """A deck and its cards as a device makes them offline: ids first, then the operations."""
    deck = deck_id()
    words = [word_id() for _ in range(cards)]
    ops = [op("deck.create", deck_id=deck, title="Поездки")] + [
        op(
            "card.create",
            deck_id=deck,
            word_id=word,
            card=card(f"word{chr(97 + n // 26)}{chr(97 + n % 26)}"),
        )
        for n, word in enumerate(words)
    ]
    return deck, words, ops


def test_a_deck_and_twenty_cards_made_offline_arrive_once_and_in_order(client: TestClient) -> None:
    deck, words, ops = offline_deck()
    results = push(client, ops)
    assert [status for status, _ in results] == ["applied"] * 21
    (got,) = pull(client)["decks"]
    assert got["id"] == deck and got["title"] == "Поездки"
    assert [c["id"] for c in got["cards"]] == words
    # Every operation again (the answer was lost): the same answers, nothing twice.
    again = push(client, ops)
    assert again == results
    (got,) = pull(client)["decks"]
    assert len(got["cards"]) == 20


def test_an_interrupted_push_is_finished_by_sending_everything_again(client: TestClient) -> None:
    _deck, _words, ops = offline_deck()
    first = push(client, ops[:8])  # the connection dropped after these
    rest = push(client, ops)
    assert rest[:8] == first
    assert [status for status, _ in rest[8:]] == ["applied"] * 13
    assert len(pull(client)["decks"][0]["cards"]) == 20


def test_two_devices_editing_one_card(client: TestClient) -> None:
    deck, (word, *_), ops = offline_deck(1)
    push(client, ops)
    base = card("wordaa")
    phone = op(
        "card.update",
        deck_id=deck,
        word_id=word,
        fields={"translation": "телефон"},
        base={"translation": base["translation"]},
    )
    laptop_example = op(
        "card.update",
        deck_id=deck,
        word_id=word,
        fields={"example": "A fresh one."},
        base={"example": base["example"]},
    )
    laptop_translation = op(
        "card.update",
        deck_id=deck,
        word_id=word,
        fields={"translation": "ноутбук"},
        base={"translation": base["translation"]},
    )
    assert [s for s, _ in push(client, [phone, laptop_example])] == ["applied", "applied"]
    # The same field, changed on the phone first: the laptop's change is reported, not applied.
    ((status, result),) = push(client, [laptop_translation])
    assert status == "conflict"
    assert result["conflicts"] == {"translation": {"mine": "ноутбук", "server": "телефон"}}
    (got,) = pull(client)["decks"][0]["cards"]
    assert (got["translation"], got["example"]) == ("телефон", "A fresh one.")


def test_a_card_deleted_offline_stays_deleted(client: TestClient) -> None:
    deck, (word, other), ops = offline_deck(2)
    push(client, ops)
    cursor = pull(client)["cursor"]
    push(client, [op("card.delete", deck_id=deck, word_id=word)])
    # Another device still edits it, or recreates it with its old id: deletion wins.
    edit = op(
        "card.update",
        deck_id=deck,
        word_id=word,
        fields={"translation": "x"},
        base={"translation": "перевод"},
    )
    revive = op("card.create", deck_id=deck, word_id=word, card=card("zzz"))
    assert [s for s, _ in push(client, [edit, revive])] == ["gone", "gone"]
    changed = pull(client, cursor=cursor)
    assert [c["id"] for c in changed["decks"][0]["cards"]] == [other]
    # Deleting it again (a retry) is fine.
    assert push(client, [op("card.delete", deck_id=deck, word_id=word)])[0][0] == "duplicate"


def test_a_deleted_deck_is_dropped_by_other_devices(client: TestClient) -> None:
    deck, _words, ops = offline_deck(2)
    push(client, ops)
    cursor = pull(client)["cursor"]
    push(client, [op("deck.delete", deck_id=deck)])
    changed = pull(client, cursor=cursor)
    assert changed["deleted_decks"] == [deck] and changed["decks"] == []
    late = op("card.create", deck_id=deck, word_id=word_id(), card=card("late"))
    assert push(client, [late])[0][0] == "gone"
    assert push(client, [op("deck.create", deck_id=deck, title="Снова")])[0][0] == "gone"


def test_only_what_changed_is_pulled_again(client: TestClient) -> None:
    _first, _, ops = offline_deck(1)
    push(client, ops)
    second = deck_id()
    push(client, [op("deck.create", deck_id=second, title="Вторая")])
    cursor = pull(client)["cursor"]
    assert pull(client, cursor=cursor)["decks"] == []
    # A change through the app's own routes counts too.
    client.patch(f"/api/decks/{second}", json={"title": "Другая"}, headers=as_("pavel"))
    changed = pull(client, cursor=cursor)
    assert [(d["id"], d["title"]) for d in changed["decks"]] == [(second, "Другая")]


def test_a_device_away_longer_than_deletions_are_kept_pulls_everything_first(
    client: TestClient,
) -> None:
    _, _, ops = offline_deck(1)
    push(client, ops)
    long_ago = NOW - timedelta(days=91)
    refused = client.post(
        "/api/sync/push",
        json={
            "ops": [op("deck.create", deck_id=deck_id(), title="Старое")],
            "pulled_at": long_ago.isoformat(),
        },
        headers=as_("pavel"),
    )
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "resync_required")
    stale = pull(client, cursor=99999, pulled_at=long_ago)
    assert stale["full"] is True and len(stale["decks"]) == 1


def test_nobody_reaches_another_persons_decks(client: TestClient) -> None:
    olga_deck, (olga_word,), ops = offline_deck(1)
    push(client, ops, user="olga")
    attempts = [
        op("deck.rename", deck_id=olga_deck, title="Моё", base_title="Поездки"),
        op("deck.delete", deck_id=olga_deck),
        op("card.create", deck_id=olga_deck, word_id=word_id(), card=card("spy")),
        op(
            "card.update",
            deck_id=olga_deck,
            word_id=olga_word,
            fields={"translation": "x"},
            base={"translation": "перевод"},
        ),
        op("card.delete", deck_id=olga_deck, word_id=olga_word),
        # Her ids, claimed for decks or cards of his own.
        op("deck.create", deck_id=olga_deck, title="Моё"),
    ]
    results = push(client, attempts, user="pavel")
    assert [s for s, _ in results] == ["rejected"] * 6
    assert {r["code"] for _, r in results} == {"deck_not_found", "id_taken"}
    mine = deck_id()
    push(client, [op("deck.create", deck_id=mine, title="Моя")], user="pavel")
    taken = op("card.create", deck_id=mine, word_id=olga_word, card=card("mine"))
    assert push(client, [taken], user="pavel")[0][1]["code"] == "id_taken"
    # Her deck is as she left it, and he pulls only his own.
    assert pull(client, user="olga")["decks"][0]["title"] == "Поездки"
    assert len(pull(client, user="olga")["decks"][0]["cards"]) == 1
    assert [d["id"] for d in pull(client, user="pavel")["decks"]] == [mine]


def test_ids_a_device_makes_must_be_new_and_unguessable(client: TestClient) -> None:
    for bad in ("g-1234", "a1-a2", "g-" + "x" * 36):
        response = client.post(
            "/api/sync/push",
            json={"ops": [op("deck.create", deck_id=bad, title="X")], "pulled_at": NOW.isoformat()},
            headers=as_("pavel"),
        )
        assert response.status_code == 422, bad


def test_a_course_word_is_linked_and_the_device_told(client: TestClient) -> None:
    deck = deck_id()
    mine = word_id()
    results = push(
        client,
        [
            op("deck.create", deck_id=deck, title="Дом", language="ru"),
            op("card.create", deck_id=deck, word_id=mine, card=card("house", "дом")),
        ],
    )
    assert results[1][1]["word_id"] == "house"
    (got,) = pull(client)["decks"][0]["cards"]
    assert (got["id"], got["from_course"]) == ("house", True)


def test_the_decks_limits_hold_offline_too(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(decks, "MAX_WORDS_PER_DECK", 2)
    deck, _, ops = offline_deck(3)
    results = push(client, ops)
    assert [s for s, _ in results] == ["applied", "applied", "applied", "rejected"]
    assert results[3][1]["code"] == "deck_full"
    dup = op("card.create", deck_id=deck, word_id=word_id(), card=card("wordaa"))
    monkeypatch.setattr(decks, "MAX_WORDS_PER_DECK", 10)
    assert push(client, [dup])[0][1]["code"] == "word_in_deck"


def test_settings_changed_offline(client: TestClient) -> None:
    client.patch("/api/me", json={"name": "Павел"}, headers=as_("pavel"))
    rename = op(
        "me.update",
        fields={"name": "Паша", "notify_morning": False},
        base={"name": "Павел", "notify_morning": True},
    )
    assert push(client, [rename])[0][0] == "applied"
    # Changed again on another device meanwhile: this one's name is reported, its switch applied.
    client.patch("/api/me", json={"name": "Павлик"}, headers=as_("pavel"))
    stale = op(
        "me.update",
        fields={"name": "Пётр", "notify_report": False},
        base={"name": "Паша", "notify_report": True},
    )
    ((status, result),) = push(client, [stale])
    assert status == "conflict" and result["conflicts"]["name"]["server"] == "Павлик"
    me = client.get("/api/me", headers=as_("pavel")).json()
    assert (me["name"], me["notify_morning"], me["notify_report"]) == ("Павлик", False, False)
    # The promise stays online: its "from tomorrow" is the server's day.
    promise = op("me.update", fields={"study_days_per_week": 3}, base={})
    assert push(client, [promise])[0][1]["code"] == "online_only"
    bad_name = op("me.update", fields={"name": "a@b.c"}, base={"name": "Павлик"})
    assert push(client, [bad_name])[0][1]["code"] == "invalid_name"


def test_old_deletions_and_operations_are_forgotten(client: TestClient, db: Session) -> None:
    deck, (word,), ops = offline_deck(1)
    push(client, [*ops, op("card.delete", deck_id=deck, word_id=word)])
    assert db.scalars(select(SyncTombstone)).all() and db.scalars(select(SyncOp)).all()
    sync.forget_old(db, NOW + timedelta(days=91))
    assert db.scalars(select(SyncTombstone)).all() == []
    assert db.scalars(select(SyncOp)).all() == []
    # Forgetting is only the memory of what happened: the deck itself stays.
    assert [d["id"] for d in pull(client)["decks"]] == [deck]
