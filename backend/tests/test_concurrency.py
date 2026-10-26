"""Two devices acting at the same instant: both pass the application-level check, and the
database constraint decides. These tests force that interleaving deterministically by making the
first read stale, instead of hoping real threads collide."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import LearningSession, ReviewAttempt, User, UserWordProgress
from app.schemas.learning import AttemptIn, StartNewSession
from app.services import sessions


def stale_once(real: Callable[..., Any], stale_value: Any) -> Callable[..., Any]:
    calls = {"n": 0}

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        calls["n"] += 1
        return stale_value if calls["n"] == 1 else real(*args, **kwargs)

    return wrapper


def test_simultaneous_answers_to_one_exercise_count_once(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = client.post("/api/sessions", json={"kind": "new", "deck_id": "starter"}).json()
    intro = session["exercises"][0]
    first = client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={"exercise_id": intro["id"], "response": {"kind": "seen"}},
    ).json()

    # The second device read the attempts before the first one committed.
    monkeypatch.setattr(sessions, "_attempts", stale_once(sessions._attempts, {}))
    user = db.scalars(select(User)).one()
    second = sessions.submit_attempt(
        db,
        user,
        session["id"],
        AttemptIn.model_validate({"exercise_id": intro["id"], "response": {"kind": "seen"}}),
        datetime.now(UTC),
    )

    assert second.model_dump(mode="json") == first
    assert db.scalar(select(func.count()).select_from(ReviewAttempt)) == 1
    progress = db.scalars(select(UserWordProgress)).one()
    assert (progress.correct_count, progress.incorrect_count) == (0, 0)


def test_simultaneous_starts_open_one_session(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    opened = client.post("/api/sessions", json={"kind": "new", "deck_id": "starter"}).json()

    # The second request did not see the first request's session yet.
    monkeypatch.setattr(sessions, "_open_session", stale_once(sessions._open_session, None))
    user = db.scalars(select(User)).one()
    again = sessions.start_session(
        db, user, StartNewSession(kind="new", deck_id="starter"), datetime.now(UTC), ZoneInfo("UTC")
    )

    assert str(again.id) == opened["id"]
    assert db.scalar(select(func.count()).select_from(LearningSession)) == 1
