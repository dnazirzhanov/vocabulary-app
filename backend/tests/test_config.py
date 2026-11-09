import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.main import create_app

DB = "postgresql+psycopg://localhost/vocab_test"


def test_dev_auth_is_refused_in_production() -> None:
    with pytest.raises(ValidationError, match="AUTH_MODE=dev cannot run"):
        Settings(environment="production", database_url=DB, auth_mode="dev", _env_file=None)


def test_only_postgres_urls_are_accepted() -> None:
    with pytest.raises(ValidationError, match="postgresql"):
        Settings(database_url="sqlite:///local.db", _env_file=None)


def test_cors_origins_are_split_and_trimmed() -> None:
    settings = Settings(
        database_url=DB, allowed_origins=" https://a.example , https://b.example,", _env_file=None
    )
    assert settings.cors_origins == ["https://a.example", "https://b.example"]


def test_the_android_app_may_call_the_api_from_its_own_origin(database: None) -> None:
    """The Android app's pages come from https://localhost (Capacitor): every method and header
    the app uses must pass the browser's check, and other origins must not."""
    settings = get_settings().model_copy(update={"allowed_origins": "https://localhost"})
    client = TestClient(create_app(settings))
    for method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        response = client.options(
            "/api/me/promise",
            headers={
                "Origin": "https://localhost",
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": (
                    "authorization, content-type, x-time-zone, if-none-match"
                ),
            },
        )
        assert response.status_code == 200, (method, response.text)
        assert response.headers["access-control-allow-origin"] == "https://localhost"
    sent = client.get("/api/health/ready", headers={"Origin": "https://localhost"})
    assert {"x-server-time", "etag"} <= set(
        sent.headers["access-control-expose-headers"].lower().replace(" ", "").split(",")
    )
    stranger = client.options(
        "/api/me",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in stranger.headers
