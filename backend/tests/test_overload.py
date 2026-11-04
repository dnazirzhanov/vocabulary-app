"""Past its limit the server refuses at once, rather than collapsing (ADR 0044)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import create_app


def client_with(limit: int) -> TestClient:
    settings = Settings(
        environment="test",
        database_url=get_settings().database_url,
        max_requests_in_flight=limit,
        _env_file=None,
    )
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


@pytest.fixture
def full(db: Session) -> Iterator[TestClient]:
    """A server already at its limit: no room for one more."""
    with client_with(0) as client:
        yield client


def test_a_full_server_refuses_with_a_code_the_web_app_can_retry(full: TestClient) -> None:
    response = full.get("/api/me")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "server_busy"
    assert response.headers["Retry-After"]


def test_nothing_of_a_refused_request_runs(full: TestClient, db: Session) -> None:
    from sqlalchemy import func, select

    from app.models import User

    full.get("/api/me", headers={"X-Dev-User": "refused"})
    assert db.scalar(select(func.count()).select_from(User)) == 0


def test_health_checks_are_answered_even_when_full(full: TestClient) -> None:
    # A host that sees failed health checks restarts the server, at the worst moment.
    assert full.get("/api/health/live").status_code == 200


def test_a_finished_request_makes_room_even_when_it_failed(db: Session) -> None:
    with client_with(1) as client:
        assert client.get("/api/nope").status_code == 404
        assert client.get("/api/sessions/not-a-uuid").status_code in (404, 422)
        assert client.get("/api/me").status_code == 200
