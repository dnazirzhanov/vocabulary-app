"""The learner's own settings and today's pace."""

from typing import Annotated

from fastapi import APIRouter, Path, Query, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.schemas.me import DeckPaceIn, DismissIn, ExtraIn, MeOut, MeUpdate, PaceOut
from app.services import decks, pace
from app.services.me import me_out, remember_time_zone, update_me
from app.services.scheduling import local_date

router = APIRouter(tags=["me"])


@router.get("/me")
def get_me(user: CurrentUser) -> MeOut:
    return me_out(user)


@router.patch("/me")
def patch_me(changes: MeUpdate, user: CurrentUser, db: DbSession, now: Now) -> MeOut:
    return update_me(db, user, changes, now)


@router.get("/me/pace")
def get_pace(
    deck_id: Annotated[str, Query(max_length=64)],
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> PaceOut:
    decks.visible_deck(db, user, deck_id)
    remember_time_zone(db, user, time_zone)  # home loads this on every visit
    return pace.pace_view(db, user, deck_id, now, time_zone)


@router.post("/me/pace/dismiss", status_code=204)
def dismiss_suggestion(body: DismissIn, user: CurrentUser, db: DbSession, now: Now) -> Response:
    """The same kind of suggestion stays quiet for a week."""
    pace.dismiss(db, user, body.kind, now)
    return Response(status_code=204)


@router.put("/decks/{deck_id}/pace")
def set_deck_pace(
    deck_id: Annotated[str, Path(max_length=64)],
    body: DeckPaceIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> PaceOut:
    """New words a day in this deck; a course level sets the whole course's (ADR 0028)."""
    deck = decks.visible_deck(db, user, deck_id)
    pace.set_deck_pace(db, user, deck, body.daily_new)
    return pace.pace_view(db, user, deck.id, now, time_zone)


@router.post("/decks/{deck_id}/pace/extra")
def add_extra(
    deck_id: Annotated[str, Path(max_length=64)],
    body: ExtraIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> PaceOut:
    """More new words in this deck, today only (ADR 0028)."""
    deck = decks.visible_deck(db, user, deck_id)
    pace.add_extra(db, user, deck, body.words, local_date(now, time_zone))
    return pace.pace_view(db, user, deck.id, now, time_zone)
