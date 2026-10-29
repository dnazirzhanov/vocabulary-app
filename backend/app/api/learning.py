"""Thin handlers: validate input, call one service function, return its contract."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Path, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.ratelimit import limit_attempts
from app.schemas.learning import (
    ActiveSessionOut,
    AttemptIn,
    AttemptResultOut,
    DeckOut,
    DeckStatsOut,
    DeckWordOut,
    GlossaryEntryOut,
    HintIn,
    HintOut,
    ProgressOut,
    SessionOut,
    StartSessionIn,
    SummaryOut,
)
from app.services import decks, progress_view, sessions, words
from app.services.me import remember_time_zone

router = APIRouter(tags=["learning"])


@router.get("/decks")
def list_decks(user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone) -> list[DeckOut]:
    return sessions.list_decks(db, user, now, time_zone)


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
    # The plan recorded on the session is counted in this zone later, on boards too.
    remember_time_zone(db, user, time_zone)
    return sessions.start_session(db, user, request, now, time_zone)


@router.get("/sessions/{session_id}")
def get_session(session_id: UUID, user: CurrentUser, db: DbSession, now: Now) -> SessionOut:
    return sessions.get_session(db, user, session_id, now)


@router.post("/sessions/{session_id}/attempts", dependencies=[Depends(limit_attempts)])
def submit_attempt(
    session_id: UUID,
    attempt: AttemptIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> AttemptResultOut:
    return sessions.submit_attempt(db, user, session_id, attempt, now, time_zone)


@router.post(
    "/sessions/{session_id}/exercises/{exercise_id}/hint", dependencies=[Depends(limit_attempts)]
)
def give_hint(
    session_id: UUID,
    exercise_id: Annotated[str, Path(max_length=8)],
    hint: HintIn,
    user: CurrentUser,
    db: DbSession,
) -> HintOut:
    return sessions.give_hint(db, user, session_id, exercise_id, hint)


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


@router.get("/progress")
def course_progress(user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone) -> ProgressOut:
    return progress_view.course_progress(db, user, now, time_zone)


@router.get("/decks/{deck_id}/stats")
def deck_stats(
    deck_id: str, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> DeckStatsOut:
    """A deck's page: my progress on it and what studying it would bring today (ADR 0020)."""
    return sessions.deck_stats(db, user, deck_id, now, time_zone)


@router.get("/decks/{deck_id}/words")
def deck_words(deck_id: str, user: CurrentUser, db: DbSession) -> list[DeckWordOut]:
    decks.visible_deck(db, user, deck_id)
    return words.deck_words(db, user, deck_id)


@router.get("/glossary")
def glossary(user: CurrentUser, db: DbSession) -> dict[str, GlossaryEntryOut]:
    """Every word form used in example sentences, for tap-a-word (small: one request per visit)."""
    return words.glossary(db)
