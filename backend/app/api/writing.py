"""Writing feature HTTP endpoints: topics, questions, and submitting an answer for feedback."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.ratelimit import limit_writing_submissions
from app.schemas.writing import (
    QuestionOut,
    SubmissionOut,
    SubmissionSummaryOut,
    SubmitIn,
    TopicOut,
)
from app.services.writing import questions as bank
from app.services.writing import submissions as submissions_svc

router = APIRouter(tags=["writing"])

DepSettings = Annotated[Settings, Depends(get_settings)]


@router.get("/writing/topics")
def list_topics(_: CurrentUser) -> list[TopicOut]:
    return [TopicOut(topic=name, question_count=count) for name, count in bank.topics()]


@router.get("/writing/questions")
def list_questions(_: CurrentUser, topic: str | None = None) -> list[QuestionOut]:
    found = bank.list_all(topic)
    if topic is not None and not found:
        raise ApiError(404, "unknown_topic", "That topic does not exist")
    return [
        QuestionOut(
            id=q.id,
            topic=q.topic,
            title=q.title,
            instruction=q.instruction,
            level=q.level,
            suggested_minutes=q.suggested_minutes,
            task_type=q.task_type,
        )
        for q in found
    ]


# A plain `def`: FastAPI runs it on a worker thread, so a slow model call never blocks the app.
@router.post("/writing/submissions", dependencies=[Depends(limit_writing_submissions)])
def submit(
    body: SubmitIn, user: CurrentUser, db: DbSession, now: Now, settings: DepSettings
) -> SubmissionOut:
    return submissions_svc.submit(db, user, body, now, settings)


@router.get("/writing/submissions")
def list_submissions(
    user: CurrentUser, db: DbSession, question_id: str | None = None
) -> list[SubmissionSummaryOut]:
    return submissions_svc.list_for_user(db, user, question_id)


@router.get("/writing/submissions/{submission_id}")
def get_submission(submission_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SubmissionOut:
    return submissions_svc.read(db, user, submission_id)
