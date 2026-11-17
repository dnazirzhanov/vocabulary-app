"""Session lifecycle for Speaking (Chunk 2): create, record upload, read, soft-delete."""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import SpeakingAudioAsset, SpeakingSession, User
from app.models.speaking import SpeakingAssessment, SpeakingFeedbackItem
from app.schemas.speaking import (
    AssessmentOut,
    AudioAssetOut,
    ExerciseType,
    FeedbackItemOut,
    PhonemeScoreOut,
    PronunciationWordOut,
    SessionDetailOut,
    SessionOut,
    SessionSummaryOut,
    TranscriptWordOut,
)
from app.services.speaking import jobs as jobs_svc
from app.services.speaking import questions
from app.services.speaking.storage import StorageClient

# Chunk 2 keeps audio for 30 days. The cleanup worker (Chunk 9) hard-deletes expired rows.
AUDIO_RETENTION_DAYS = 30
# MIME types we currently accept on upload. ffprobe content validation lands in Chunk 3.
ALLOWED_AUDIO_MIME = frozenset(
    {
        "audio/webm",
        "audio/webm;codecs=opus",
        "audio/ogg",
        "audio/ogg;codecs=opus",
        "audio/mp4",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
    }
)


def list_for_user(
    db: Session, user: User, question_id: str | None = None
) -> list[SessionSummaryOut]:
    """Return all non-deleted sessions for the user, optionally filtered to one question."""
    stmt = (
        select(SpeakingSession, SpeakingAssessment)
        .outerjoin(SpeakingAssessment, SpeakingAssessment.session_id == SpeakingSession.id)
        .where(SpeakingSession.user_id == user.id)
        .order_by(SpeakingSession.started_at.desc())
    )
    if question_id is not None:
        stmt = stmt.where(SpeakingSession.question_id == question_id)
    rows = db.execute(stmt).all()
    return [
        SessionSummaryOut(
            id=session.id,
            question_id=session.question_id,
            status=session.status,
            started_at=session.started_at,
            completed_at=session.completed_at,
            overall_score=assessment.overall_score if assessment else None,
            pronunciation_score=assessment.pronunciation_score if assessment else None,
            fluency_score=assessment.fluency_score if assessment else None,
            vocabulary_score=assessment.vocabulary_score if assessment else None,
            grammar_score=assessment.grammar_score if assessment else None,
            coherence_score=assessment.coherence_score if assessment else None,
        )
        for session, assessment in rows
    ]


def create(db: Session, user: User, exercise_type: ExerciseType, question_id: str) -> SessionOut:
    """Start a new speaking session for `user`. The chosen question must exist and match type."""
    question = questions.by_id(question_id)
    if question is None:
        raise ApiError(404, "question_not_found", f"Unknown question: {question_id}")
    if question.exercise_type != exercise_type:
        raise ApiError(400, "question_type_mismatch", "Question does not match exercise_type.")
    session = SpeakingSession(
        user_id=user.id,
        exercise_type=exercise_type,
        question_id=question_id,
        status="created",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _to_session_out(session)


def _owned(db: Session, user: User, session_id: uuid.UUID) -> SpeakingSession:
    """Load a session and enforce ownership. Returns 404 when either missing or not owned (so the
    endpoint doesn't leak existence to other users)."""
    session = db.get(SpeakingSession, session_id)
    if session is None or session.user_id != user.id:
        raise ApiError(404, "session_not_found", "No such speaking session.")
    return session


def read(db: Session, user: User, session_id: uuid.UUID) -> SessionDetailOut:
    session = _owned(db, user, session_id)
    audio = db.scalar(
        select(SpeakingAudioAsset)
        .where(SpeakingAudioAsset.session_id == session.id)
        .where(SpeakingAudioAsset.deleted_at.is_(None))
    )
    assessment = db.scalar(
        select(SpeakingAssessment).where(SpeakingAssessment.session_id == session.id)
    )
    feedback_items: list[SpeakingFeedbackItem] = []
    if assessment is not None:
        feedback_items = list(
            db.scalars(
                select(SpeakingFeedbackItem).where(
                    SpeakingFeedbackItem.assessment_id == assessment.id
                )
            )
        )
    return SessionDetailOut(
        **_to_session_out(session).model_dump(),
        audio=None if audio is None else _to_audio_out(audio),
        assessment=None if assessment is None else _to_assessment_out(assessment, feedback_items),
    )


async def upload_audio(
    db: Session,
    storage: StorageClient,
    user: User,
    session_id: uuid.UUID,
    now: datetime,
    *,
    content: bytes,
    mime_type: str,
    duration_ms: int | None,
    sample_rate: int | None,
    max_bytes: int,
) -> SessionDetailOut:
    """Validate the upload, write it to storage, record the audio asset, mark session uploaded.

    Idempotency: if the session already has a non-deleted audio asset, the upload is rejected to
    avoid duplicate storage writes from retries. The learner can DELETE the session and start
    over if they want to re-record."""
    session = _owned(db, user, session_id)
    if session.status != "created":
        raise ApiError(409, "session_not_recordable", "Session is already uploaded or processed.")
    if mime_type not in ALLOWED_AUDIO_MIME:
        raise ApiError(
            400,
            "unsupported_audio_mime",
            f"Unsupported audio type: {mime_type}",
        )
    if len(content) == 0:
        raise ApiError(400, "empty_audio", "Audio file is empty.")
    if len(content) > max_bytes:
        raise ApiError(413, "audio_too_large", "Audio file exceeds the size limit.")
    # 2-minute hard limit on claimed duration; actual probe lands in Chunk 3.
    if duration_ms is not None and (duration_ms < 0 or duration_ms > 130_000):
        raise ApiError(400, "invalid_duration", "Reported duration is out of range.")
    if sample_rate is not None and (sample_rate < 4_000 or sample_rate > 96_000):
        raise ApiError(400, "invalid_sample_rate", "Reported sample rate is out of range.")

    storage_path = _path_for(user.id, session.id, mime_type)
    await storage.upload(storage_path, content, mime_type)

    asset = SpeakingAudioAsset(
        session_id=session.id,
        storage_mode=storage.mode,
        storage_path=storage_path,
        mime_type=mime_type,
        byte_size=len(content),
        duration_ms=duration_ms,
        sample_rate=sample_rate,
        uploaded_at=now,
        expires_at=now + timedelta(days=AUDIO_RETENTION_DAYS),
    )
    db.add(asset)
    session.status = "uploaded"
    db.flush()
    db.refresh(session)
    db.refresh(asset)
    # Enqueue a transcription job; idempotent if one already exists.
    jobs_svc.enqueue(db, session.id, "assess")
    db.commit()

    return SessionDetailOut(
        **_to_session_out(session).model_dump(),
        audio=_to_audio_out(asset),
        assessment=None,
    )


async def soft_delete(
    db: Session,
    storage: StorageClient,
    user: User,
    session_id: uuid.UUID,
    now: datetime,
) -> None:
    """Mark the session's audio as deleted and remove it from storage. The DB row is kept for
    audit; the cleanup worker (Chunk 9) hard-deletes later."""
    session = _owned(db, user, session_id)
    assets = db.scalars(
        select(SpeakingAudioAsset).where(SpeakingAudioAsset.session_id == session.id)
    ).all()
    for asset in assets:
        if asset.deleted_at is not None:
            continue
        await storage.delete(asset.storage_path)
        asset.deleted_at = now
    if session.status != "failed":
        session.status = "failed"
        session.failure_reason = "deleted_by_user"
        session.completed_at = now
    db.commit()


def _path_for(user_id: uuid.UUID, session_id: uuid.UUID, mime_type: str) -> str:
    ext = _extension_for(mime_type)
    return f"{user_id}/{session_id}{ext}"


def _extension_for(mime_type: str) -> str:
    primary = mime_type.split(";", 1)[0].strip()
    return {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
    }.get(primary, ".bin")


def _to_session_out(session: SpeakingSession) -> SessionOut:
    return SessionOut(
        id=session.id,
        exercise_type=session.exercise_type,
        question_id=session.question_id,
        status=session.status,
        failure_reason=session.failure_reason,
        started_at=session.started_at,
        completed_at=session.completed_at,
    )


def _to_audio_out(asset: SpeakingAudioAsset) -> AudioAssetOut:
    return AudioAssetOut(
        mime_type=asset.mime_type,
        byte_size=asset.byte_size,
        duration_ms=asset.duration_ms,
        sample_rate=asset.sample_rate,
        uploaded_at=asset.uploaded_at,
    )


def _to_assessment_out(
    assessment: SpeakingAssessment,
    feedback_items: list[SpeakingFeedbackItem] | None = None,
) -> AssessmentOut:
    # pronunciation_words are stored in evidence["azure_pa"]["words"] (Chunk 4+).
    pa_evidence = (assessment.evidence or {}).get("azure_pa") or {}
    raw_pron_words = pa_evidence.get("words") or []
    pronunciation_words = [
        PronunciationWordOut(
            word=w["word"],
            accuracy_score=w["accuracy_score"],
            error_type=w.get("error_type", "None"),
            phonemes=[
                PhonemeScoreOut(phoneme=p["phoneme"], accuracy_score=p["accuracy_score"])
                for p in (w.get("phonemes") or [])
            ],
        )
        for w in raw_pron_words
    ]
    return AssessmentOut(
        id=assessment.id,
        transcript=assessment.transcript,
        transcript_words=[TranscriptWordOut(**w) for w in (assessment.transcript_words or [])],
        pronunciation_score=assessment.pronunciation_score,
        fluency_score=assessment.fluency_score,
        vocabulary_score=assessment.vocabulary_score,
        grammar_score=assessment.grammar_score,
        coherence_score=assessment.coherence_score,
        overall_score=assessment.overall_score,
        pronunciation_words=pronunciation_words,
        feedback_items=[
            FeedbackItemOut(
                category=fi.category,
                severity=fi.severity,
                original_text=fi.original_text,
                corrected_text=fi.corrected_text,
                explanation=fi.explanation,
            )
            for fi in (feedback_items or [])
        ],
        created_at=assessment.created_at,
    )
