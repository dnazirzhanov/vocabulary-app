"""The learner's own settings and today's pace."""

from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.schemas.me import DismissIn, MeOut, MeUpdate, PaceOut
from app.services import decks, pace
from app.services.me import me_out, remember_time_zone, update_me

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
