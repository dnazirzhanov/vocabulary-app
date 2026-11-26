"""The ready-made course hidden (ADR 0093): with COURSE_DECKS off, «Английский по уровням» is gone
on every path, for a Russian learner too; their own decks stay; switched back on, it returns with
the progress kept."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Deck


def a_course(db: Session) -> str:
    deck = db.scalars(select(Deck).where(Deck.kind == "course")).first()
    assert deck is not None, "the tests' database holds the course"
    return deck.id


def test_hidden_on_every_path_and_my_own_decks_stay(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    course = a_course(db)
    client.patch("/api/me", json={"daily_target_words": 5, "language": "ru"})
    mine = client.post("/api/decks", json={"title": "Мои слова"}).json()
    assert client.get(f"/api/decks/{course}/stats").status_code == 200  # open while switched on
    device = {"device_id": str(uuid4())}
    before = client.get("/api/study/pack", params=device)
    assert any(deck["kind"] == "course" for deck in before.json()["decks"])

    monkeypatch.setattr(get_settings(), "course_decks", False)
    # Home's «Английский по уровням» comes from this list: empty, so the entry is gone.
    assert client.get("/api/decks").json() == []
    assert client.get(f"/api/decks/{course}/stats").status_code == 404
    assert client.get(f"/api/decks/{course}/words").status_code == 404
    started = client.post("/api/sessions", json={"kind": "study", "deck_id": course})
    assert started.status_code == 404
    # The study pack this device keeps (lessons, spelling, «Планы» offline): no course.
    # A device holding the old pack is told it changed, and gets it without the course.
    again = client.get(
        "/api/study/pack", params=device, headers={"If-None-Match": before.headers["etag"]}
    )
    assert again.status_code == 200
    pack = again.json()
    assert pack["course_open"] is False
    assert all(deck["kind"] != "course" for deck in pack["decks"])
    progress = client.get("/api/progress/decks").json()
    assert all(deck["kind"] != "course" for deck in progress["decks"])
    # My own deck is untouched.
    home = client.get("/api/decks/library").json()
    assert [deck["id"] for deck in home["mine"]] == [mine["id"]]
    assert client.get(f"/api/decks/{mine['id']}/stats").status_code == 200

    # Switched back on: the course returns.
    monkeypatch.setattr(get_settings(), "course_decks", True)
    assert client.get(f"/api/decks/{course}/stats").status_code == 200
    assert client.get("/api/decks").json()


def test_off_unless_switched_on() -> None:
    from app.core.config import Settings

    assert Settings.model_fields["course_decks"].default is False
