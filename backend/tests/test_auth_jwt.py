"""Production sign-in: Supabase-issued tokens verified locally against the issuer's public keys."""

import os
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2
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
from app.models import DeletedLogin, User

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
        "supabase_secret_key": "test-secret",
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
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=a
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


# --- deleting an account (ADR 0043) ---------------------------------------------------------


class FakeSupabase:
    """Stands in for the Admin API at the HTTP call: what was asked, and what it answers."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.status = 200
        self.down = False

    def delete(self, url: str, *, headers: dict[str, str], timeout: float) -> httpx2.Response:
        self.calls.append((url, headers))
        if self.down:
            raise httpx2.ConnectError("no route to host")
        return httpx2.Response(self.status, request=httpx2.Request("DELETE", url))


@pytest.fixture
def supabase(monkeypatch: pytest.MonkeyPatch) -> FakeSupabase:
    fake = FakeSupabase()
    monkeypatch.setattr(httpx2, "delete", fake.delete)
    return fake


def just_signed_in(sub: str) -> dict[str, str]:
    return bearer(token(sub, amr=[{"method": "password", "timestamp": int(time.time())}]))


def subjects(db: Session) -> list[str]:
    db.expire_all()
    return list(db.scalars(select(User.auth_subject)))


def test_deleting_an_account_removes_the_login_too(
    jwt_client: TestClient, db: Session, supabase: FakeSupabase
) -> None:
    headers = just_signed_in("abc-123")
    assert jwt_client.get("/api/me", headers=headers).status_code == 200

    assert jwt_client.delete("/api/me", headers=headers).status_code == 204

    assert subjects(db) == []
    url, sent = supabase.calls[0]
    assert url == f"{ISSUER}/admin/users/abc-123"
    assert sent["apikey"] == "test-secret"


def test_a_login_supabase_no_longer_has_counts_as_deleted(
    jwt_client: TestClient, db: Session, supabase: FakeSupabase
) -> None:
    supabase.status = 404
    headers = just_signed_in("abc-123")
    assert jwt_client.get("/api/me", headers=headers).status_code == 200
    assert jwt_client.delete("/api/me", headers=headers).status_code == 204
    assert subjects(db) == []


@pytest.mark.parametrize("failure", ["down", "refuses"])
def test_when_supabase_fails_nothing_is_deleted_and_a_retry_works(
    jwt_client: TestClient, db: Session, supabase: FakeSupabase, failure: str
) -> None:
    supabase.down = failure == "down"
    supabase.status = 500 if failure == "refuses" else 200
    headers = just_signed_in("abc-123")
    assert jwt_client.get("/api/me", headers=headers).status_code == 200

    assert error_code(jwt_client.delete("/api/me", headers=headers)) == (
        503,
        "account_delete_failed",
    )
    assert subjects(db) == ["supabase|abc-123"]

    supabase.down, supabase.status = False, 200
    assert jwt_client.delete("/api/me", headers=headers).status_code == 204
    assert subjects(db) == []


def test_a_stale_token_after_deletion_is_refused_and_recreates_nothing(
    jwt_client: TestClient, db: Session, supabase: FakeSupabase
) -> None:
    headers = just_signed_in("abc-123")
    assert jwt_client.get("/api/me", headers=headers).status_code == 200
    assert jwt_client.delete("/api/me", headers=headers).status_code == 204

    # The phone still holds a token that stays valid until it expires.
    assert error_code(jwt_client.get("/api/me", headers=headers)) == (401, "invalid_token")
    assert subjects(db) == []
    # Someone else is not affected.
    assert jwt_client.get("/api/me", headers=bearer(token("other"))).status_code == 200


def test_the_record_of_a_deleted_login_is_kept_only_about_a_day(
    jwt_client: TestClient, db: Session, supabase: FakeSupabase
) -> None:
    db.add(
        DeletedLogin(auth_subject="supabase|old", deleted_at=datetime.now(UTC) - timedelta(days=2))
    )
    db.commit()
    headers = just_signed_in("abc-123")
    assert jwt_client.get("/api/me", headers=headers).status_code == 200
    assert jwt_client.delete("/api/me", headers=headers).status_code == 204
    db.expire_all()
    assert list(db.scalars(select(DeletedLogin.auth_subject))) == ["supabase|abc-123"]


@pytest.mark.parametrize(
    "claims",
    [
        {},  # no amr at all: refused, not assumed
        {"amr": "password"},
        {"amr": [{"method": "password"}]},
        {"amr": [{"method": "password", "timestamp": "soon"}]},
        {"amr": [{"method": "password", "timestamp": 1_000}]},
    ],
)
def test_deleting_needs_a_fresh_sign_in(
    jwt_client: TestClient, db: Session, supabase: FakeSupabase, claims: dict[str, Any]
) -> None:
    headers = bearer(token("abc-123", **claims))
    assert jwt_client.get("/api/me", headers=headers).status_code == 200
    assert error_code(jwt_client.delete("/api/me", headers=headers)) == (403, "reauth_required")
    assert subjects(db) == ["supabase|abc-123"]
    assert supabase.calls == []


def test_production_refuses_to_start_without_the_secret_key() -> None:
    with pytest.raises(ValidationError, match="SUPABASE_SECRET_KEY"):
        jwt_settings(environment="production", supabase_secret_key=None)
    assert "test-secret" not in repr(jwt_settings())
