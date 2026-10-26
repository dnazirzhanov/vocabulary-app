"""Production sign-in: Supabase-issued tokens verified locally against the issuer's public keys."""

import os
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import auth
from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import User

ISSUER = "https://example-project.supabase.co/auth/v1"
SIGNING_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())
JWKS = {
    "keys": [
        {**jwt.algorithms.ECAlgorithm.to_jwk(SIGNING_KEY.public_key(), as_dict=True), "kid": "k1"}
    ]
}


def jwt_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": os.environ["DATABASE_URL"],
        "auth_mode": "jwt",
        "auth_issuer": ISSUER,
        "_env_file": None,
    }
    return Settings(**(values | overrides))


@pytest.fixture
def jwt_client(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    # The real PyJWKClient runs (kid lookup, caching); only the HTTP fetch is replaced.
    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", lambda self: JWKS)
    auth._signing_keys.cache_clear()
    settings = jwt_settings()
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client
    auth._signing_keys.cache_clear()


def token(
    sub: str = "user-a",
    *,
    key: ec.EllipticCurvePrivateKey = SIGNING_KEY,
    lifetime: timedelta = timedelta(minutes=30),
    **claims: Any,
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": sub,
        "iss": ISSUER,
        "aud": "authenticated",
        "iat": now,
        "exp": now + lifetime,
    } | claims
    return jwt.encode(payload, key, algorithm="ES256", headers={"kid": "k1"})


def bearer(value: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {value}"}


def error_code(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["error"]["code"]


def test_a_valid_token_identifies_the_learner(jwt_client: TestClient, db: Session) -> None:
    assert jwt_client.get("/api/decks", headers=bearer(token("abc-123"))).status_code == 200
    assert db.scalars(select(User.auth_subject)).one() == "supabase|abc-123"


@pytest.mark.parametrize(
    ("make_headers", "expected"),
    [
        (lambda: {}, "not_signed_in"),
        (lambda: {"Authorization": "Basic abc"}, "not_signed_in"),
        (lambda: bearer("not-a-jwt"), "invalid_token"),
        (lambda: bearer(token(lifetime=timedelta(minutes=-1))), "invalid_token"),
        (lambda: bearer(token(iss="https://evil.example/auth/v1")), "invalid_token"),
        (lambda: bearer(token(aud="anon")), "invalid_token"),
        (lambda: bearer(token(key=OTHER_KEY)), "invalid_token"),
        # Algorithm confusion: an HMAC token "signed" with public material must not pass.
        (
            lambda: bearer(
                jwt.encode(
                    {"sub": "x", "iss": ISSUER, "aud": "authenticated", "exp": 9999999999},
                    "a-shared-secret-that-is-long-enough-for-hs256",
                    algorithm="HS256",
                    headers={"kid": "k1"},
                )
            ),
            "invalid_token",
        ),
    ],
)
def test_requests_without_a_valid_token_are_refused(
    jwt_client: TestClient,
    make_headers: Callable[[], dict[str, str]],
    expected: str,
) -> None:
    assert error_code(jwt_client.get("/api/decks", headers=make_headers())) == (401, expected)


def test_development_headers_are_ignored_in_jwt_mode(jwt_client: TestClient, db: Session) -> None:
    headers = bearer(token("real-user")) | {
        "X-Dev-User": "someone-else",
        "X-Dev-Now": "2030-01-01T00:00:00+00:00",
    }
    response = jwt_client.get("/api/decks", headers=headers)
    assert response.status_code == 200
    assert db.scalars(select(User.auth_subject)).one() == "supabase|real-user"
    assert not response.headers["X-Server-Time"].startswith("2030")


def test_learners_with_different_tokens_are_isolated(jwt_client: TestClient) -> None:
    a, b = bearer(token("learner-a")), bearer(token("learner-b"))
    session = jwt_client.post(
        "/api/sessions", json={"kind": "new", "deck_id": "starter"}, headers=a
    ).json()
    assert jwt_client.get(f"/api/sessions/{session['id']}", headers=b).status_code == 404
    assert jwt_client.get(f"/api/sessions/{session['id']}", headers=a).status_code == 200


def test_jwt_mode_settings_are_validated() -> None:
    with pytest.raises(ValidationError, match="AUTH_ISSUER"):
        jwt_settings(auth_issuer=None)
    with pytest.raises(ValidationError, match="https"):
        jwt_settings(auth_issuer="http://example.com/auth/v1")
    production = jwt_settings(environment="production", auth_issuer=ISSUER + "/")
    assert production.jwks_url == ISSUER + "/.well-known/jwks.json"
