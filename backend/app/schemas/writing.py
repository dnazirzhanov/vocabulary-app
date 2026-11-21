"""API contracts for the Writing feature."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.services.writing.schema import AnyEvaluation

SubmissionStatus = Literal["pending", "done", "failed"]
FeedbackLanguage = Literal["en", "ru", "uz", "kk", "ky", "tg"]


class TopicOut(BaseModel):
    topic: str
    question_count: int


class QuestionOut(BaseModel):
    id: str
    topic: str
    title: str
    instruction: str
    level: str | None
    suggested_minutes: int | None
    # IELTS Task 2 type (ADR 0081); None for the retired general questions.
    task_type: str | None = None


class SubmitIn(BaseModel):
    # Made by the browser once per attempt; a retry of the same attempt carries the same id.
    client_id: uuid.UUID
    question_id: str = Field(min_length=1, max_length=64)
    answer: str
    time_spent_seconds: int | None = Field(default=None, ge=0, le=24 * 60 * 60)
    feedback_language: FeedbackLanguage = "en"

    @field_validator("answer")
    @classmethod
    def _not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("The answer is empty")
        return value.strip()


class SubmissionOut(BaseModel):
    id: uuid.UUID
    question_id: str
    # Whole question, so the screens can offer "write it again" without another request.
    question: QuestionOut | None
    answer: str
    time_spent_seconds: int | None
    status: SubmissionStatus
    failure_code: str | None
    evaluation: AnyEvaluation | None
    created_at: datetime


class SubmissionSummaryOut(BaseModel):
    id: uuid.UUID
    question_id: str
    question_title: str
    # The question's topic, so the archive can group essays as the home groups questions.
    question_topic: str = ""
    status: SubmissionStatus
    overall: int | None
    cefr_level: str | None = None
    # The IELTS overall band (ADR 0081); None for answers marked on the general rubric.
    band: float | None = None
    word_count: int = 0
    excerpt: str = ""
    created_at: datetime
