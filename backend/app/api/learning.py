"""Thin handlers: validate input, call one service function, return its contract."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.ratelimit import limit_attempts
from app.schemas.learning import (
    ActiveSessionOut,
    AttemptIn,
    AttemptResultOut,
    DeckOut,
    DeckWordOut,
    ProgressOut,
    SessionOut,
    StartSessionIn,
    SummaryOut,
)
from app.services import progress, sessions, words

router = APIRouter(tags=["learning"])


@router.get("/decks")
def list_decks(user: CurrentUser, db: DbSession, now: Now) -> list[DeckOut]:
    return sessions.list_decks(db, user, now)


# Declared before /sessions/{session_id} so "active" is not parsed as an id.
@router.get("/sessions/active")
def active_session(user: CurrentUser, db: DbSession, now: Now) -> ActiveSessionOut:
    return sessions.active_session(db, user, now)


@router.post("/sessions")
def start_session(
    request: Annotated[StartSessionIn, Body()],
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> SessionOut:
    return sessions.start_session(db, user, request, now, time_zone)


@router.get("/sessions/{session_id}")
def get_session(session_id: UUID, user: CurrentUser, db: DbSession, now: Now) -> SessionOut:
    return sessions.get_session(db, user, session_id, now)


@router.post("/sessions/{session_id}/attempts", dependencies=[Depends(limit_attempts)])
def submit_attempt(
    session_id: UUID, attempt: AttemptIn, user: CurrentUser, db: DbSession, now: Now
) -> AttemptResultOut:
    return sessions.submit_attempt(db, user, session_id, attempt, now)


@router.post("/sessions/{session_id}/complete")
def complete_session(
    session_id: UUID, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> SummaryOut:
    return sessions.complete_session(db, user, session_id, now, time_zone)


@router.delete("/me", status_code=204)
def delete_account(user: CurrentUser, db: DbSession) -> Response:
    """Deletes the learner and, by cascade, every session, attempt and progress record."""
    sessions.delete_learner(db, user)
    return Response(status_code=204)


@router.get("/decks/{deck_id}/progress")
def deck_progress(
    deck_id: str, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> ProgressOut:
    sessions.require_published_deck(db, deck_id)
    return progress.deck_progress(db, user, deck_id, now, time_zone)


@router.get("/decks/{deck_id}/words")
def deck_words(deck_id: str, user: CurrentUser, db: DbSession) -> list[DeckWordOut]:
    sessions.require_published_deck(db, deck_id)
    return words.deck_words(db, user, deck_id)
