"""Speaking pipeline orchestration — Chunk 4: Whisper + Azure PA (pronunciation exercises).

For 'spontaneous' sessions: Whisper transcription only (no Azure PA — no reference text).
For 'pronunciation' sessions: Whisper + Azure PA run concurrently via ThreadPoolExecutor.
  Minimum evidence check before assigning pronunciation_score (≥10 words, ≥3 s).
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.speaking import (
    SpeakingAssessment,
    SpeakingAudioAsset,
    SpeakingJob,
    SpeakingSession,
)
from app.services.speaking import jobs as jobs_svc
from app.services.speaking import questions as questions_svc
from app.services.speaking.pronunciation import (
    PronunciationError,
    PronunciationResult,
    assess,
    meets_minimum_evidence,
)
from app.services.speaking.storage import StorageClient
from app.services.speaking.transcription import TranscriptionError, transcribe

log = logging.getLogger(__name__)


def run_assess_job(
    db: Session,
    storage: StorageClient,
    job: SpeakingJob,
    *,
    openai_api_key: str,
    azure_speech_key: str | None = None,
    azure_speech_region: str = "westeurope",
    now: datetime,
) -> None:
    """Run the full assessment pipeline for a claimed job.

    Writes the assessment row and marks session done/failed. Unexpected exceptions
    propagate up — the worker handles retry logic."""
    session = db.get(SpeakingSession, job.session_id)
    if session is None:
        jobs_svc.complete(db, job)
        db.commit()
        return

    audio = db.scalar(
        select(SpeakingAudioAsset)
        .where(SpeakingAudioAsset.session_id == session.id)
        .where(SpeakingAudioAsset.deleted_at.is_(None))
    )
    if audio is None:
        _fail_session(db, session, job, "audio_deleted", now)
        db.commit()
        return

    # --- Step 1: download audio ---
    try:
        audio_bytes = storage.download_sync(audio.storage_path)
    except Exception as exc:
        raise RuntimeError(f"Could not download audio {audio.storage_path}: {exc}") from exc

    session.status = "processing"
    db.flush()

    is_pronunciation = session.exercise_type == "pronunciation"
    reference_text: str | None = None
    if is_pronunciation:
        question = questions_svc.by_id(session.question_id)
        reference_text = question.reference_text if question else None

    # --- Step 2: run providers concurrently ---
    transcript_result = None
    pron_result: PronunciationResult | None = None
    transcript_error: str | None = None
    pron_skipped = False

    with ThreadPoolExecutor(max_workers=2) as pool:
        whisper_fut = pool.submit(transcribe, audio_bytes, audio.mime_type, openai_api_key)
        azure_fut = None

        if is_pronunciation and reference_text and azure_speech_key:
            azure_fut = pool.submit(
                assess,
                audio_bytes,
                audio.mime_type,
                reference_text,
                azure_speech_key,
                azure_speech_region,
            )
        else:
            pron_skipped = True

        try:
            transcript_result = whisper_fut.result()
        except TranscriptionError as exc:
            transcript_error = f"transcription_failed:{exc.code}"
        except Exception as exc:
            transcript_error = f"transcription_error:{type(exc).__name__}"

        if azure_fut is not None:
            try:
                pron_result = azure_fut.result()
            except PronunciationError as exc:
                log.warning("Azure PA failed (non-fatal): %s", exc)
            except Exception as exc:
                log.warning("Azure PA unexpected error (non-fatal): %s", exc)

    # Transcription failure is fatal — no transcript, no assessment.
    if transcript_result is None:
        reason = transcript_error or "transcription_failed:unknown"
        _fail_session(db, session, job, reason, now)
        db.commit()
        return

    # --- Step 3: derive pronunciation score ---
    pronunciation_score: float | None = None
    pron_evidence: dict[str, object]

    if pron_skipped:
        pron_evidence = {"skipped": "no_key" if not azure_speech_key else "not_pronunciation_type"}
    elif pron_result is None:
        pron_evidence = {"skipped": "provider_error"}
    else:
        word_count = len(transcript_result.words)
        duration_ms = transcript_result.duration_ms
        if meets_minimum_evidence(word_count, duration_ms):
            pronunciation_score = pron_result.pronunciation_score
        pron_evidence = {
            **pron_result.raw,
            "words": [
                {
                    "word": w.word,
                    "accuracy_score": w.accuracy_score,
                    "error_type": w.error_type,
                    "phonemes": [
                        {"phoneme": p.phoneme, "accuracy_score": p.accuracy_score}
                        for p in w.phonemes
                    ],
                }
                for w in pron_result.words
            ],
        }

    # --- Step 4: persist assessment ---
    assessment = SpeakingAssessment(
        session_id=session.id,
        audio_asset_id=audio.id,
        transcript=transcript_result.transcript,
        transcript_words=[
            {
                "word": w.word,
                "start_ms": w.start_ms,
                "end_ms": w.end_ms,
                "confidence": w.confidence,
            }
            for w in transcript_result.words
        ],
        pronunciation_score=pronunciation_score,
        evidence={"whisper": transcript_result.raw, "azure_pa": pron_evidence},
    )
    db.add(assessment)
    session.status = "done"
    session.completed_at = now
    jobs_svc.complete(db, job)
    db.commit()


def _fail_session(
    db: Session,
    session: SpeakingSession,
    job: SpeakingJob,
    reason: str,
    now: datetime,
) -> None:
    session.status = "failed"
    session.failure_reason = reason[:64]
    session.completed_at = now
    jobs_svc.complete(db, job)
