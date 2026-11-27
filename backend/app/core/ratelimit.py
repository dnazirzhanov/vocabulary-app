"""Small per-learner rate limits.

In-process and per instance: enough for one server during the pilot. Retries of the same answer are
already harmless (ADR 0003); the answer limit stops scripted floods from filling the attempts
table, and the join limit stops anyone from guessing invite codes (ADR 0011).
"""

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.core.auth import CurrentUser
from app.core.config import Settings, get_settings
from app.core.errors import ApiError

WINDOW_SECONDS = 60.0
JOINS_PER_MINUTE = 10
# The app reporting its own errors (ADR 0094): enough to see a problem, never a flood.
CLIENT_ERRORS_PER_HOUR = 20
_recent: dict[tuple[str, UUID], deque[float]] = defaultdict(deque)
_lock = Lock()


def _check(
    bucket: str,
    user_id: UUID,
    limit: int,
    message: str,
    window: float = WINDOW_SECONDS,
    code: str = "rate_limited",
) -> None:
    now = time.monotonic()
    with _lock:
        stamps = _recent[(bucket, user_id)]
        while stamps and now - stamps[0] > window:
            stamps.popleft()
        if len(stamps) >= limit:
            raise ApiError(429, code, message)
        stamps.append(now)


def limit_attempts(user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]) -> None:
    _check(
        "attempts", user.id, settings.attempts_per_minute, "Too many answers at once; wait a moment"
    )


def limit_joins(user: CurrentUser) -> None:
    _check("joins", user.id, JOINS_PER_MINUTE, "Too many invite codes tried; wait a minute")


def limit_generations(
    user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]
) -> None:
    """Each draft costs a model call (ADR 0018)."""
    _check(
        "generations",
        user.id,
        settings.generations_per_day,
        "Too many drafts today; try again tomorrow",
        window=24 * 60 * 60,
        code="generation_limit",
    )


def limit_mentor_chats(
    user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]
) -> None:
    """Each mentor chat message costs a model call."""
    _check(
        "mentor_chats",
        user.id,
        settings.mentor_chats_per_day,
        "Too many mentor chats today; try again tomorrow",
        window=24 * 60 * 60,
        code="mentor_chat_limit",
    )


def limit_speaking_sessions(
    user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]
) -> None:
    """One speaking session = one upload + (later chunks) one assessment pipeline run.
    Guards storage cost and provider cost (Chunks 3+)."""
    _check(
        "speaking_sessions",
        user.id,
        settings.speaking_sessions_per_day,
        "Too many speaking sessions today; try again tomorrow",
        window=24 * 60 * 60,
        code="speaking_session_limit",
    )


def limit_writing_submissions(
    user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]
) -> None:
    """Every submission is one paid model call."""
    _check(
        "writing_submissions",
        user.id,
        settings.writing_submissions_per_day,
        "Too many writing submissions today; try again tomorrow",
        window=24 * 60 * 60,
        code="writing_limit",
    )


def mentor_chats_used(user_id: UUID) -> int:
    """Current number of mentor chat calls within the last 24 hours."""
    now = time.monotonic()
    window = 24 * 60 * 60.0
    with _lock:
        stamps = _recent.get(("mentor_chats", user_id))
        if not stamps:
            return 0
        return sum(1 for t in stamps if now - t <= window)


def reset_limits() -> None:
    """For tests."""
    with _lock:
        _recent.clear()


def limit_new_pronunciations(user_id: UUID, settings: Settings) -> None:
    """Each new text is one paid call to the voice; texts already made are free and unlimited."""
    _check(
        "pronunciations",
        user_id,
        settings.pronunciations_per_day,
        "Too many new words spoken today; try again tomorrow",
        window=24 * 60 * 60,
        code="pronunciation_limit",
    )


def limit_client_errors(user: CurrentUser) -> None:
    _check(
        "client-errors",
        user.id,
        CLIENT_ERRORS_PER_HOUR,
        "Too many error reports; wait a while",
        window=3600.0,
    )


def limit_youtube_captions(
    user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]
) -> None:
    """Each new video is one request to YouTube (ADR 0100)."""
    _check(
        "youtube_captions",
        user.id,
        settings.youtube_captions_per_hour,
        "Too many videos this hour; try again later",
        window=60 * 60,
        code="captions_limit",
    )
