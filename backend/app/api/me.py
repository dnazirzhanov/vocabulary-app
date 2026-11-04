"""The learner's own settings and today's pace."""

from typing import Annotated

from fastapi import APIRouter, Path, Query, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, SentTimeZone, TimeZone
from app.schemas.me import (
    DeckPaceIn,
    DismissIn,
    ExtraIn,
    MeOut,
    MeUpdate,
    PaceOut,
    PauseIn,
    PromiseIn,
    PromiseOut,
)
from app.services import decks, pace
from app.services.me import me_out, remember_time_zone, update_me
from app.services.promise import end_pause, promise_out, set_pause, set_weekdays
from app.services.scheduling import local_date

router = APIRouter(tags=["me"])


@router.get("/me")
def get_me(
    user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone, sent_zone: SentTimeZone
) -> MeOut:
    remember_time_zone(db, user, sent_zone)  # the app asks on every open (ADR 0042)
    return me_out(db, user, now, time_zone)


@router.patch("/me")
def patch_me(
    changes: MeUpdate, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> MeOut:
    return update_me(db, user, changes, now, time_zone)


@router.put("/me/promise")
def put_promise(
    body: PromiseIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> PromiseOut:
    """Promise these weekdays from tomorrow (ADR 0039)."""
    today = local_date(now, time_zone)
    set_weekdays(db, user, body.weekdays, today)
    return promise_out(db, user, today)


@router.put("/me/promise/pause")
def put_pause(
    body: PauseIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> PromiseOut:
    """Pause the promise from tomorrow until a date, at most 31 days."""
    today = local_date(now, time_zone)
    set_pause(db, user, body.until, today)
    return promise_out(db, user, today)


@router.delete("/me/promise/pause")
def delete_pause(user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone) -> PromiseOut:
    today = local_date(now, time_zone)
    end_pause(db, user, today)
    return promise_out(db, user, today)


@router.get("/me/pace")
def get_pace(
    deck_id: Annotated[str, Query(max_length=64)],
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> PaceOut:
    decks.visible_deck(db, user, deck_id)
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
