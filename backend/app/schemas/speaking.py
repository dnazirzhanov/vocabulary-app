"""API contracts for the Speaking feature."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ExerciseType = Literal["spontaneous", "pronunciation"]
SessionStatus = Literal["created", "uploaded", "processing", "done", "failed"]


class CreateSessionIn(BaseModel):
    exercise_type: ExerciseType
    question_id: str = Field(min_length=1, max_length=64)


class SessionOut(BaseModel):
    id: uuid.UUID
    exercise_type: ExerciseType
    question_id: str
    status: SessionStatus
    failure_reason: str | None
    started_at: datetime
    completed_at: datetime | None


class AudioAssetOut(BaseModel):
    mime_type: str
    byte_size: int
    duration_ms: int | None
    sample_rate: int | None
    uploaded_at: datetime


class TranscriptWordOut(BaseModel):
    word: str
    start_ms: int
    end_ms: int
    confidence: float


class PhonemeScoreOut(BaseModel):
    phoneme: str
    accuracy_score: float


class PronunciationWordOut(BaseModel):
    word: str
    accuracy_score: float
    error_type: str
    phonemes: list[PhonemeScoreOut]


class AssessmentOut(BaseModel):
    id: uuid.UUID
    transcript: str
    transcript_words: list[TranscriptWordOut]
    pronunciation_score: float | None
    fluency_score: float | None
    vocabulary_score: float | None
    grammar_score: float | None
    coherence_score: float | None
    overall_score: float | None
    # Populated for pronunciation exercises after Azure PA runs.
    pronunciation_words: list[PronunciationWordOut] = []
    created_at: datetime


class SessionDetailOut(SessionOut):
    audio: AudioAssetOut | None
    assessment: AssessmentOut | None = None


class QuestionOut(BaseModel):
    id: str
    exercise_type: ExerciseType
    text: str
    level: str | None = None
    reference_text: str | None = None
