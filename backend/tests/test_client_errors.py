"""The app's own errors, reported (ADR 0094): kept for the learner who saw them, cut to size, a few
an hour."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ratelimit import CLIENT_ERRORS_PER_HOUR
from app.models import ClientError, User

REPORT = {
    "place": "deck-page",
    "name": "TypeError",
    "message": "Cannot read properties of undefined (reading 'translation')",
    "stack": "at exerciseOut (lessons.ts:254)\nat present (lessons.ts:277)",
    "build": "index-CHDCN7YW.js",
}


def test_a_report_is_kept_for_the_learner_who_saw_it(client: TestClient, db: Session) -> None:
    sent = client.post(
        "/api/client-errors", json=REPORT, headers={"X-Dev-User": "anna", "User-Agent": "Safari"}
    )
    assert sent.status_code == 204
    kept = db.scalars(select(ClientError)).one()
    anna = db.scalars(select(User).where(User.id == kept.user_id)).one()
    assert anna.auth_subject.endswith("anna")
    assert (kept.place, kept.name, kept.build, kept.agent) == (
        "deck-page",
        "TypeError",
        "index-CHDCN7YW.js",
        "Safari",
    )
    assert "exerciseOut" in kept.stack


def test_long_texts_are_cut_and_floods_refused(client: TestClient, db: Session) -> None:
    long = REPORT | {"message": "x" * 3000, "stack": "y" * 7000}
    assert client.post("/api/client-errors", json=long).status_code == 204
    kept = db.scalars(select(ClientError)).one()
    assert len(kept.message) == 1000 and len(kept.stack) == 4000
    for _ in range(CLIENT_ERRORS_PER_HOUR - 1):
        assert client.post("/api/client-errors", json=REPORT).status_code == 204
    assert client.post("/api/client-errors", json=REPORT).status_code == 429
