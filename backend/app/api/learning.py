"""Thin handlers: validate input, call one service function, return its contract."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body

from app.core.auth import CurrentUser, DbSession
from app.schemas.learning import (
    ActiveSessionOut,
    AttemptIn,
    AttemptResultOut,
    DeckOut,
    SessionOut,
    StartSessionIn,
    SummaryOut,
)
from app.services import sessions

router = APIRouter(tags=["learning"])


@router.get("/decks")
def list_decks(user: CurrentUser, db: DbSession) -> list[DeckOut]:
    return sessions.list_decks(db, user)


# Declared before /sessions/{session_id} so "active" is not parsed as an id.
@router.get("/sessions/active")
def active_session(user: CurrentUser, db: DbSession) -> ActiveSessionOut:
    return sessions.active_session(db, user)


@router.post("/sessions")
def start_session(
    request: Annotated[StartSessionIn, Body()], user: CurrentUser, db: DbSession
) -> SessionOut:
    return sessions.start_session(db, user, request)


@router.get("/sessions/{session_id}")
def get_session(session_id: UUID, user: CurrentUser, db: DbSession) -> SessionOut:
    return sessions.get_session(db, user, session_id)


@router.post("/sessions/{session_id}/attempts")
def submit_attempt(
    session_id: UUID, attempt: AttemptIn, user: CurrentUser, db: DbSession
) -> AttemptResultOut:
    return sessions.submit_attempt(db, user, session_id, attempt)


@router.post("/sessions/{session_id}/complete")
def complete_session(session_id: UUID, user: CurrentUser, db: DbSession) -> SummaryOut:
    return sessions.complete_session(db, user, session_id)
