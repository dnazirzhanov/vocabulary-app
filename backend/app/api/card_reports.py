from typing import Annotated

from fastapi import APIRouter, Path

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.schemas.card_reports import CardReportIn, CardReportsOut
from app.services import card_reports

router = APIRouter(tags=["card reports"])
Id = Annotated[str, Path(max_length=64)]


@router.post("/card-reports", status_code=204)
def report(body: CardReportIn, user: CurrentUser, db: DbSession, now: Now) -> None:
    """A card I study is wrong (a device without its own store sends it here; others sync it)."""
    card_reports.report(db, user, body.deck_id, body.word_id, body.reason, body.note, now)
    db.commit()


@router.get("/card-reports")
def course_reports(user: CurrentUser, db: DbSession) -> CardReportsOut:
    """Open reports on the course's cards: the content editors only."""
    return card_reports.course_reports(db, user)


@router.get("/decks/{deck_id}/card-reports")
def deck_reports(deck_id: Id, user: CurrentUser, db: DbSession) -> CardReportsOut:
    """Open reports on the cards of a deck I wrote."""
    return card_reports.deck_reports(db, user, deck_id)


@router.post("/card-reports/{word_id}/resolve", status_code=204)
def resolve(word_id: Id, user: CurrentUser, db: DbSession, now: Now) -> None:
    card_reports.resolve(db, user, word_id, now)
