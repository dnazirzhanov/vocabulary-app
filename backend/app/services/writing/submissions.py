"""Saving answers and their feedback. Every query is scoped to the signed-in learner."""

import uuid
from datetime import datetime, timedelta

from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.models import User, WritingSubmission
from app.schemas.writing import QuestionOut, SubmissionOut, SubmissionSummaryOut, SubmitIn
from app.services.writing import evaluator
from app.services.writing import questions as bank
from app.services.writing.schema import AnyEvaluation

_EVALUATION: TypeAdapter[AnyEvaluation] = TypeAdapter(AnyEvaluation)

# A `pending` row older than this was abandoned (the server restarted mid-call): it may be retried.
STALE_AFTER = timedelta(minutes=3)
# The archive: every essay a learner wrote, with enough of each to recognise it.
ARCHIVE_LIMIT = 500
EXCERPT_CHARS = 140


def _title(question_id: str) -> str:
    question = bank.get(question_id)
    return question.title if question else question_id


def _question_out(question_id: str) -> QuestionOut | None:
    q = bank.get(question_id)
    if q is None:
        return None
    return QuestionOut(
        id=q.id,
        topic=q.topic,
        title=q.title,
        instruction=q.instruction,
        level=q.level,
        suggested_minutes=q.suggested_minutes,
        task_type=q.task_type,
    )


def _out(row: WritingSubmission) -> SubmissionOut:
    return SubmissionOut(
        id=row.id,
        question_id=row.question_id,
        question=_question_out(row.question_id),
        answer=row.answer,
        time_spent_seconds=row.time_spent_seconds,
        status=row.status,
        failure_code=row.failure_code,
        evaluation=_EVALUATION.validate_python(row.evaluation) if row.evaluation else None,
        created_at=row.created_at,
    )


def _mine(db: Session, user: User, submission_id: uuid.UUID) -> WritingSubmission:
    row = db.scalar(
        select(WritingSubmission).where(
            WritingSubmission.id == submission_id, WritingSubmission.user_id == user.id
        )
    )
    if row is None:
        # Someone else's id looks exactly like one that does not exist.
        raise ApiError(404, "not_found", "Submission not found")
    return row


def read(db: Session, user: User, submission_id: uuid.UUID) -> SubmissionOut:
    return _out(_mine(db, user, submission_id))


def excerpt(answer: str) -> str:
    """The essay's opening on one line, cut at a word and marked when cut."""
    flat = " ".join(answer.split())
    if len(flat) <= EXCERPT_CHARS:
        return flat
    cut = flat[:EXCERPT_CHARS].rsplit(" ", 1)[0] or flat[:EXCERPT_CHARS]
    return cut.rstrip(" ,;:.") + "…"


def list_for_user(
    db: Session, user: User, question_id: str | None = None, limit: int = ARCHIVE_LIMIT
) -> list[SubmissionSummaryOut]:
    query = select(WritingSubmission).where(WritingSubmission.user_id == user.id)
    if question_id is not None:
        query = query.where(WritingSubmission.question_id == question_id)
    rows = db.scalars(query.order_by(WritingSubmission.created_at.desc()).limit(limit)).all()
    return [
        SubmissionSummaryOut(
            id=r.id,
            question_id=r.question_id,
            question_title=_title(r.question_id),
            status=r.status,
            overall=(r.evaluation or {}).get("overall"),
            cefr_level=(r.evaluation or {}).get("cefr_level"),
            band=(r.evaluation or {}).get("band"),
            word_count=len(r.answer.split()),
            excerpt=excerpt(r.answer),
            created_at=r.created_at,
        )
        for r in rows
    ]


def submit(
    db: Session, user: User, body: SubmitIn, now: datetime, settings: Settings
) -> SubmissionOut:
    question = bank.get(body.question_id)
    if question is None:
        raise ApiError(404, "unknown_question", "That question does not exist")
    if len(body.answer) > settings.writing_max_answer_chars:
        raise ApiError(400, "answer_too_long", "The answer is too long")

    row = db.scalar(
        select(WritingSubmission).where(
            WritingSubmission.user_id == user.id, WritingSubmission.client_id == body.client_id
        )
    )
    if row is not None:
        if row.question_id != body.question_id:
            raise ApiError(409, "conflict", "This attempt belongs to another question")
        if row.status == "done":
            return _out(row)  # a double tap or a retried request: the same feedback, no new call
        if row.status == "pending" and now - row.created_at.astimezone(now.tzinfo) < STALE_AFTER:
            raise ApiError(409, "writing_in_progress", "This answer is already being checked")
        # A failed (or abandoned) attempt: the learner may have edited the text meanwhile.
        row.answer, row.time_spent_seconds = body.answer, body.time_spent_seconds
        row.feedback_language, row.status, row.failure_code = (
            body.feedback_language,
            "pending",
            None,
        )
        row.created_at = now
        db.commit()
    else:
        row = WritingSubmission(
            user_id=user.id,
            client_id=body.client_id,
            question_id=body.question_id,
            answer=body.answer,
            time_spent_seconds=body.time_spent_seconds,
            feedback_language=body.feedback_language,
            status="pending",
            created_at=now,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            # Two taps at the same moment: the other request won; this one is a duplicate.
            db.rollback()
            raise ApiError(
                409, "writing_in_progress", "This answer is already being checked"
            ) from None

    # The row is saved, so the answer survives whatever happens next.
    try:
        evaluation = evaluator.evaluate(question, body.answer, body.feedback_language, settings)
    except ApiError as error:
        db.execute(
            update(WritingSubmission)
            .where(WritingSubmission.id == row.id)
            .values(status="failed", failure_code=error.code)
        )
        db.commit()
        raise
    db.refresh(row)
    row.status, row.failure_code = "done", None
    row.evaluation = evaluation.model_dump()
    row.model = settings.deepseek_model
    row.evaluated_at = now
    db.commit()
    return _out(row)
