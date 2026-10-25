"""The single place handlers learn who is calling (ADR 0004, ADR 0009)."""

import re
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.errors import ApiError
from app.models import User

DEV_USER_HEADER = "X-Dev-User"
_DEV_NAME = re.compile(r"[a-z0-9-]{1,32}")
# Asymmetric algorithms only: the legacy shared-secret (HS256) tokens are refused.
_ALGORITHMS = ["ES256", "RS256"]


@lru_cache
def _signing_keys(jwks_url: str) -> jwt.PyJWKClient:
    # Keys are cached for 10 minutes, matching Supabase's own edge cache, so a revoked key stops
    # working quickly; an unknown key id triggers a refetch.
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=600, timeout=5)


def subject_from_token(token: str, settings: Settings) -> str:
    """Verify signature, expiry, issuer and audience; return the provider's user id."""
    try:
        key = _signing_keys(settings.jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=_ALGORITHMS,
            audience=settings.auth_audience,
            issuer=settings.auth_issuer,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except (jwt.PyJWKClientError, jwt.InvalidTokenError) as exc:
        raise ApiError(401, "invalid_token", "Please sign in again") from exc
    subject = claims["sub"]
    if not isinstance(subject, str) or not subject:
        raise ApiError(401, "invalid_token", "Please sign in again")
    return subject


def _auth_subject(request: Request, settings: Settings) -> str:
    if settings.auth_mode == "jwt":
        scheme, _, token = request.headers.get("Authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise ApiError(401, "not_signed_in", "Sign in to continue")
        return f"supabase|{subject_from_token(token, settings)}"
    # Dev mode only (settings validation keeps it out of production): the header picks between
    # local development identities and is never honoured in jwt mode.
    name = request.headers.get(DEV_USER_HEADER, "local")
    if not _DEV_NAME.fullmatch(name):
        raise ApiError(400, "invalid_dev_user", f"{DEV_USER_HEADER} must match [a-z0-9-]{{1,32}}")
    return f"dev|{name}"


def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    subject = _auth_subject(request, settings)
    user = db.scalar(select(User).where(User.auth_subject == subject))
    if user is None:
        db.execute(
            insert(User)
            .values(auth_subject=subject)
            .on_conflict_do_nothing(index_elements=[User.auth_subject])
        )
        db.commit()
        user = db.scalar(select(User).where(User.auth_subject == subject))
    assert user is not None
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
