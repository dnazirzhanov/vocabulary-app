"""Speaking feature ORM models."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SpeakingSession(Base):
    """One speaking exercise attempt by a learner. `status` reflects the pipeline lifecycle.

    Chunk 2 uses only `created` → `uploaded`. Chunks 3+ add `processing` → `done` / `failed`."""

    __tablename__ = "speaking_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Exercise this session belongs to: 'spontaneous' (open answer) | 'pronunciation' (scripted).
    exercise_type: Mapped[str] = mapped_column(String(16))
    # Reference into the static question bank (not a FK yet; questions live in code).
    question_id: Mapped[str] = mapped_column(String(64))
    # Lifecycle: created → uploaded → processing → done / failed.
    status: Mapped[str] = mapped_column(String(16), server_default="created")
    failure_reason: Mapped[str | None] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SpeakingAudioAsset(Base):
    """A recorded audio blob attached to one SpeakingSession. Soft-delete via `deleted_at`;
    Chunk 9's cleanup worker hard-deletes rows where `expires_at` has passed."""

    __tablename__ = "speaking_audio_assets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("speaking_sessions.id", ondelete="CASCADE"), index=True
    )
    # 'filesystem' or 'supabase' — which backend the file lives in (tells the worker how to fetch).
    storage_mode: Mapped[str] = mapped_column(String(16))
    # Opaque key for the storage backend (path on disk, or <bucket>/<key> for Supabase).
    storage_path: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    sample_rate: Mapped[int | None] = mapped_column(Integer)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Default 30 days; nightly worker (Chunk 9) hard-deletes anything past this.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Set when the learner tapped delete; the worker then removes it from storage too.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SpeakingJob(Base):
    """A background job processed by the speaking worker. One 'assess' job per session."""

    __tablename__ = "speaking_jobs"
    __table_args__ = (
        UniqueConstraint("session_id", "kind", name="uq_speaking_jobs_session_id_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("speaking_sessions.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32))  # 'assess' | 'cleanup_audio'
    status: Mapped[str] = mapped_column(String(16), server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_by: Mapped[str | None] = mapped_column(String(128))
    not_before: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SpeakingAssessment(Base):
    """Results of the speaking pipeline for one session. Nullable scores = insufficient evidence."""

    __tablename__ = "speaking_assessments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("speaking_sessions.id", ondelete="CASCADE"), index=True
    )
    audio_asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("speaking_audio_assets.id", ondelete="CASCADE")
    )
    assessment_version: Mapped[int] = mapped_column(Integer, server_default="1")
    # Raw, never corrected.
    transcript: Mapped[str] = mapped_column(Text)
    # [{word, start_ms, end_ms, confidence}]
    transcript_words: Mapped[list[Any]] = mapped_column(JSON)
    pronunciation_score: Mapped[float | None] = mapped_column(Float)
    fluency_score: Mapped[float | None] = mapped_column(Float)
    vocabulary_score: Mapped[float | None] = mapped_column(Float)
    grammar_score: Mapped[float | None] = mapped_column(Float)
    coherence_score: Mapped[float | None] = mapped_column(Float)
    overall_score: Mapped[float | None] = mapped_column(Float)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SpeakingFeedbackItem(Base):
    """A single feedback item (pronunciation/grammar/vocab/coherence/fluency) for an assessment."""

    __tablename__ = "speaking_feedback_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("speaking_assessments.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))
    original_text: Mapped[str | None] = mapped_column(Text)
    corrected_text: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    evidence_ref: Mapped[dict[str, Any] | None] = mapped_column(JSON)
