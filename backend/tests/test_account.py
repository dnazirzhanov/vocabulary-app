from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import LearningSession, ReviewAttempt, User, UserWordProgress
from tests.support import Play

START_NEW = {"kind": "new", "deck_id": "starter"}


def count(db: Session, model: type) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def test_deleting_an_account_removes_every_learning_record(
    client: TestClient, db: Session, play: Play
) -> None:
    play(START_NEW, datetime.now(UTC))
    other = client.get("/api/decks", headers={"X-Dev-User": "someone-else"})
    assert other.status_code == 200
    assert count(db, ReviewAttempt) > 0

    assert client.delete("/api/me").status_code == 204
    db.expire_all()
    assert (
        count(db, LearningSession) == count(db, ReviewAttempt) == count(db, UserWordProgress) == 0
    )
    assert db.scalars(select(User.auth_subject)).all() == ["dev|someone-else"]
    # Coming back starts from zero.
    assert client.get("/api/decks").json()[0]["introduced_count"] == 0


def test_answer_floods_are_rate_limited(db: Session) -> None:
    settings = Settings(
        environment="test",
        database_url=get_settings().database_url,
        attempts_per_minute=3,
        _env_file=None,
    )
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        session = client.post("/api/sessions", json=START_NEW).json()
        path = f"/api/sessions/{session['id']}/attempts"
        body = {"exercise_id": "1", "response": {"kind": "seen"}}
        assert [client.post(path, json=body).status_code for _ in range(3)] == [200] * 3
        blocked = client.post(path, json=body)
        assert (blocked.status_code, blocked.json()["error"]["code"]) == (429, "rate_limited")


@pytest.fixture
def web_client(db: Session, tmp_path: Path) -> TestClient:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>app</title>")
    (tmp_path / "assets" / "app.js").write_text("console.log('app')")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    settings = Settings(
        environment="test",
        database_url=get_settings().database_url,
        web_dist=str(tmp_path),
        _env_file=None,
    )
    return TestClient(create_app(settings))


def test_the_api_serves_the_web_app(web_client: TestClient) -> None:
    home = web_client.get("/")
    assert home.status_code == 200 and "<title>app</title>" in home.text
    assert home.headers["Cache-Control"] == "no-cache"
    assert "<title>app</title>" in web_client.get("/progress/anything").text  # SPA fallback
    assert web_client.get("/assets/app.js").text == "console.log('app')"
    assert web_client.get("/favicon.svg").text == "<svg/>"


def test_web_app_serving_never_leaks_files_or_hides_api_errors(web_client: TestClient) -> None:
    escaped = web_client.get("/..%2F..%2Fetc%2Fpasswd")
    assert "root:" not in escaped.text
    missing = web_client.get("/api/nope")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "not_found")
    assert web_client.get("/api/health/live").json() == {"status": "ok"}
