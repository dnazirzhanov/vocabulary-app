"""Texts people add to Reading Mode, and their categories (round 2)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response

from app.api.decks import get_provider
from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.core.ratelimit import limit_generations
from app.schemas.readings import (
    AnswerIn,
    AnswerOut,
    CategoryIn,
    CategoryOut,
    NewReadingIn,
    ReadingChangeIn,
    ReadingListOut,
    ReadingOut,
)
from app.services import reading_answers, readings
from app.services.generation import Provider

router = APIRouter(tags=["readings"])
Drafting = Annotated[Provider, Depends(get_provider)]


@router.get("/readings")
def my_readings(user: CurrentUser, db: DbSession) -> ReadingListOut:
    return readings.library(db, user)


@router.post("/readings", status_code=201, dependencies=[Depends(limit_generations)])
def add_reading(
    body: NewReadingIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    provider: Drafting,
    background: BackgroundTasks,
) -> ReadingOut:
    """Saved at once; its meanings are written after the answer, and the reader shows them when
    ready (`status`)."""
    reading = readings.create(db, user, body, now)
    background.add_task(readings.draft_in_background, reading.id, provider, now)
    return reading


@router.get("/readings/{reading_id}")
def get_reading(reading_id: UUID, user: CurrentUser, db: DbSession) -> ReadingOut:
    return readings.get(db, user, reading_id)


@router.patch("/readings/{reading_id}")
def change_reading(
    reading_id: UUID, body: ReadingChangeIn, user: CurrentUser, db: DbSession, now: Now
) -> ReadingOut:
    return readings.change(db, user, reading_id, body, now)


@router.delete("/readings/{reading_id}", status_code=204)
def delete_reading(reading_id: UUID, user: CurrentUser, db: DbSession) -> Response:
    readings.delete(db, user, reading_id)
    return Response(status_code=204)


@router.post("/readings/{reading_id}/draft", dependencies=[Depends(limit_generations)])
def redraft_reading(
    reading_id: UUID,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    provider: Drafting,
    background: BackgroundTasks,
) -> ReadingOut:
    """Its meanings again, after they failed."""
    reading = readings.redraft(db, user, reading_id, now)
    background.add_task(readings.draft_in_background, reading.id, provider, now)
    return reading


@router.post("/reading-categories", status_code=201)
def add_category(body: CategoryIn, user: CurrentUser, db: DbSession, now: Now) -> CategoryOut:
    return readings.add_category(db, user, body, now)


@router.patch("/reading-categories/{category_id}")
def rename_category(
    category_id: UUID, body: CategoryIn, user: CurrentUser, db: DbSession
) -> CategoryOut:
    return readings.rename_category(db, user, category_id, body)


@router.delete("/reading-categories/{category_id}", status_code=204)
def delete_category(category_id: UUID, user: CurrentUser, db: DbSession) -> Response:
    readings.delete_category(db, user, category_id)
    return Response(status_code=204)


@router.get("/reading-answers")
def my_answers(reading: str, user: CurrentUser, db: DbSession) -> list[AnswerOut]:
    """My answers to one text's questions (`library:<article>` or `reading:<id>`)."""
    return reading_answers.answers(db, user, reading)


@router.get("/reading-answers/counts")
def my_answer_counts(user: CurrentUser, db: DbSession) -> dict[str, int]:
    """How many questions of each text I have answered, for the library's rows."""
    return reading_answers.counts(db, user)


@router.put("/reading-answers", status_code=204)
def answer(body: AnswerIn, user: CurrentUser, db: DbSession, now: Now) -> Response:
    """An answer sent straight away (a device without its own store uses the outbox otherwise)."""
    reading_answers.answer(db, user, body.question_ref, body.text, now, body.choice)
    db.commit()
    return Response(status_code=204)
