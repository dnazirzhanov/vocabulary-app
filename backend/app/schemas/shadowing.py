"""API contracts for the Shadowing feature."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class SentenceOut(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class ExerciseOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    description: str
    difficulty: str
    language: str
    duration_ms: int
    transcript: str
    sentences: list[SentenceOut]
    speaker: str | None
    has_audio: bool
    display_order: int


class CreateAttemptIn(BaseModel):
    exercise_id: uuid.UUID


class AttemptOut(BaseModel):
    id: uuid.UUID
    exercise_id: uuid.UUID
    duration_ms: int | None
    completed_at: datetime | None
    created_at: datetime


class ExerciseStatusOut(BaseModel):
    exercise_id: uuid.UUID
    attempts_count: int
    completed_count: int
    last_attempted_at: datetime | None


class AttemptListItem(BaseModel):
    id: uuid.UUID
    duration_ms: int | None
    completed_at: datetime | None
    created_at: datetime
    has_audio: bool
