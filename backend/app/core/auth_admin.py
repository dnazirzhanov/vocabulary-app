"""Removing a login from the auth provider (ADR 0043): the one call that needs its secret key."""

import logging
from urllib.parse import quote

import httpx2

from app.core.config import Settings
from app.core.errors import ApiError

logger = logging.getLogger("app.auth_admin")


def delete_login(settings: Settings, subject: str) -> None:
    """Deletes a `supabase|<id>` login. One already gone counts: a retry must be able to finish."""
    failed = ApiError(503, "account_delete_failed", "The account could not be deleted, try again")
    if settings.supabase_secret_key is None:
        logger.error("SUPABASE_SECRET_KEY is not set, so a login can't be deleted")
        raise failed
    login_id = subject.removeprefix("supabase|")
    url = f"{settings.auth_issuer}/admin/users/{quote(login_id, safe='')}"
    try:
        response = httpx2.delete(
            url, headers={"apikey": settings.supabase_secret_key.get_secret_value()}, timeout=5.0
        )
    except httpx2.HTTPError as exc:
        logger.error("Deleting a login did not reach Supabase: %s", type(exc).__name__)
        raise failed from exc
    if response.status_code != 404 and not response.is_success:
        logger.error("Supabase refused to delete a login: %s", response.status_code)
        raise failed
