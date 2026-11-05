"""A group's spelling tests (ADR 0046): setting them up, the results, and taking them."""

from uuid import UUID

from fastapi import APIRouter

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.schemas.group_tests import (
    AnswerIn,
    OpenTestIn,
    SaveTestIn,
    StartAttemptIn,
    TestAttemptOut,
    TestDetailOut,
    TestSetupOut,
    TestsOut,
)
from app.services import group_tests

router = APIRouter(tags=["group tests"])


@router.get("/groups/{group_id}/tests")
def list_tests(group_id: UUID, user: CurrentUser, db: DbSession, now: Now) -> TestsOut:
    return group_tests.list_tests(db, user, group_id, now)


@router.get("/groups/{group_id}/tests/{deck_id}")
def test_detail(
    group_id: UUID, deck_id: str, user: CurrentUser, db: DbSession, now: Now
) -> TestDetailOut:
    return group_tests.test_detail(db, user, group_id, deck_id, now)


@router.get("/groups/{group_id}/tests/{deck_id}/setup")
def test_setup(group_id: UUID, deck_id: str, user: CurrentUser, db: DbSession) -> TestSetupOut:
    return group_tests.test_setup(db, user, group_id, deck_id)


@router.put("/groups/{group_id}/tests/{deck_id}")
def save_test(
    group_id: UUID, deck_id: str, body: SaveTestIn, user: CurrentUser, db: DbSession
) -> TestSetupOut:
    return group_tests.save_test(db, user, group_id, deck_id, body)


@router.put("/groups/{group_id}/tests/{deck_id}/open")
def set_open(
    group_id: UUID, deck_id: str, body: OpenTestIn, user: CurrentUser, db: DbSession, now: Now
) -> TestDetailOut:
    return group_tests.set_open(db, user, group_id, deck_id, body.open, now)


@router.post("/groups/{group_id}/tests/{deck_id}/attempts")
def start_attempt(
    group_id: UUID, deck_id: str, body: StartAttemptIn, user: CurrentUser, db: DbSession, now: Now
) -> TestAttemptOut:
    """Starts, or returns the attempt already running, so it is safe to repeat."""
    return group_tests.start_attempt(db, user, group_id, deck_id, body.kind, body.only_weak, now)


@router.get("/test-attempts/{attempt_id}")
def get_attempt(attempt_id: UUID, user: CurrentUser, db: DbSession, now: Now) -> TestAttemptOut:
    return group_tests.get_attempt(db, user, attempt_id, now)


@router.post("/test-attempts/{attempt_id}/answers")
def answer_question(
    attempt_id: UUID, body: AnswerIn, user: CurrentUser, db: DbSession, now: Now
) -> TestAttemptOut:
    """Safe to retry: the first answer to a question stands."""
    return group_tests.answer_question(db, user, attempt_id, body.question_id, body.answer, now)
