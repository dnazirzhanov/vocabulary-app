"""Speaking pipeline orchestration.

Provider map:
  spontaneous  → Whisper + Azure PA (unscripted) + fluency + vocabulary + grammar (LLM) + coherence
  pronunciation → Whisper + Azure PA (scripted)   + fluency + vocabulary + grammar (LLM) + coherence

All providers run concurrently via ThreadPoolExecutor where possible.
Minimum-evidence rules gate each score independently.
Azure PA failures and optional-provider failures (grammar, coherence) are non-fatal.
Transcription failure is fatal — no transcript, no assessment.
"""

from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.speaking import (
    SpeakingAssessment,
    SpeakingAudioAsset,
    SpeakingFeedbackItem,
    SpeakingJob,
    SpeakingSession,
)
from app.services.speaking import jobs as jobs_svc
from app.services.speaking import questions as questions_svc
from app.services.speaking.coherence import CoherenceError, CoherenceResult, assess_coherence
from app.services.speaking.coherence import meets_minimum_evidence as coherence_min_evidence
from app.services.speaking.feedback import FeedbackError, FeedbackResult, generate_feedback
from app.services.speaking.feedback import meets_minimum_evidence as feedback_min_evidence
from app.services.speaking.fluency import FluencyResult, compute_fluency
from app.services.speaking.fluency import meets_minimum_evidence as fluency_min_evidence
from app.services.speaking.grammar import GrammarError_, GrammarResult, check_grammar
from app.services.speaking.grammar import meets_minimum_evidence as grammar_min_evidence
from app.services.speaking.grammar_llm import check_grammar_llm
from app.services.speaking.pronunciation import (
    PronunciationError,
    PronunciationResult,
    assess,
    assess_unscripted,
)
from app.services.speaking.pronunciation import (
    meets_minimum_evidence as pronunciation_min_evidence,
)
from app.services.speaking.storage import StorageClient
from app.services.speaking.transcription import TranscriptionError, TranscriptResult, transcribe
from app.services.speaking.vocabulary import VocabularyResult, compute_vocabulary
from app.services.speaking.vocabulary import meets_minimum_evidence as vocabulary_min_evidence

log = logging.getLogger(__name__)


def run_assess_job(
    db: Session,
    storage: StorageClient,
    job: SpeakingJob,
    *,
    openai_api_key: str,
    azure_speech_key: str | None = None,
    azure_speech_region: str = "westeurope",
    language_tool_url: str | None = None,
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

    try:
        audio_bytes = storage.download_sync(audio.storage_path)
    except Exception as exc:
        raise RuntimeError(f"Could not download audio {audio.storage_path}: {exc}") from exc

    session.status = "processing"
    db.flush()

    is_pronunciation = session.exercise_type == "pronunciation"
    reference_text: str | None = None
    question_text = ""
    question = questions_svc.by_id(session.question_id)
    if question:
        question_text = question.text
        if is_pronunciation:
            reference_text = question.reference_text

    # --- Concurrently run Whisper + Azure PA ---
    transcript_result = None
    pron_result: PronunciationResult | None = None
    transcript_error: str | None = None

    with ThreadPoolExecutor(max_workers=4) as pool:
        whisper_fut: Future[object] = pool.submit(
            transcribe, audio_bytes, audio.mime_type, openai_api_key
        )

        azure_fut: Future[object] | None = None
        if azure_speech_key:
            if is_pronunciation and reference_text:
                azure_fut = pool.submit(
                    assess,
                    audio_bytes,
                    audio.mime_type,
                    reference_text,
                    azure_speech_key,
                    azure_speech_region,
                )
            else:
                # Spontaneous speech: use unscripted pronunciation assessment.
                azure_fut = pool.submit(
                    assess_unscripted,
                    audio_bytes,
                    audio.mime_type,
                    azure_speech_key,
                    azure_speech_region,
                )

        try:
            transcript_result = cast("TranscriptResult", whisper_fut.result())
        except TranscriptionError as exc:
            transcript_error = f"transcription_failed:{exc.code}"
        except Exception as exc:
            transcript_error = f"transcription_error:{type(exc).__name__}"

        if azure_fut is not None:
            try:
                pron_result = azure_fut.result()  # type: ignore[assignment]
            except PronunciationError as exc:
                log.warning("Azure PA failed (non-fatal): %s", exc)
            except Exception as exc:
                log.warning("Azure PA unexpected error (non-fatal): %s", exc)

    if transcript_result is None:
        _fail_session(db, session, job, transcript_error or "transcription_failed:unknown", now)
        db.commit()
        return

    word_count = len(transcript_result.words)
    duration_ms = transcript_result.duration_ms
    transcript_text = transcript_result.transcript

    # --- Deterministic providers ---
    fluency_result: FluencyResult | None = None
    vocab_result: VocabularyResult | None = None

    if fluency_min_evidence(word_count, duration_ms):
        fluency_result = compute_fluency(transcript_result.words, duration_ms)

    if vocabulary_min_evidence(word_count):
        try:
            vocab_result = compute_vocabulary(transcript_text)
        except Exception as exc:
            log.error("Vocabulary assessment failed (non-fatal): %s", exc, exc_info=True)

    # --- Grammar + coherence: both use OpenAI ---
    grammar_result: GrammarResult | None = None
    coherence_result: CoherenceResult | None = None

    grammar_enabled = grammar_min_evidence(word_count)
    coherence_enabled = coherence_min_evidence(word_count) and bool(question_text)

    if grammar_enabled or coherence_enabled:
        with ThreadPoolExecutor(max_workers=2) as pool:
            grammar_fut: Future[object] | None = None
            coherence_fut: Future[object] | None = None

            if grammar_enabled:
                if language_tool_url:
                    grammar_fut = pool.submit(
                        check_grammar, transcript_text, language_tool_url, word_count
                    )
                else:
                    grammar_fut = pool.submit(
                        check_grammar_llm, transcript_text, openai_api_key
                    )

            if coherence_enabled:
                coherence_fut = pool.submit(
                    assess_coherence,
                    transcript_text,
                    question_text,
                    openai_api_key,
                )

            if grammar_fut is not None:
                try:
                    grammar_result = grammar_fut.result()  # type: ignore[assignment]
                except GrammarError_ as exc:
                    log.warning("Grammar check failed (non-fatal): %s", exc)
                except Exception as exc:
                    log.warning("Grammar check unexpected error (non-fatal): %s", exc)

            if coherence_fut is not None:
                try:
                    coherence_result = coherence_fut.result()  # type: ignore[assignment]
                except CoherenceError as exc:
                    log.warning("Coherence assessment failed (non-fatal): %s", exc)
                except Exception as exc:
                    log.warning("Coherence unexpected error (non-fatal): %s", exc)

    # --- Derive scores ---
    pronunciation_score: float | None = None
    pron_evidence: dict[str, object]
    if pron_result is not None:
        if pronunciation_min_evidence(word_count, duration_ms):
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
    else:
        pron_evidence = {"skipped": "provider_error" if azure_speech_key else "no_key"}

    fluency_score = fluency_result.score if fluency_result else None
    vocabulary_score = vocab_result.score if vocab_result else None
    grammar_score = grammar_result.score if grammar_result else None
    coherence_score = coherence_result.score if coherence_result else None

    overall_score = _compute_overall(
        pronunciation_score, fluency_score, vocabulary_score, grammar_score, coherence_score
    )

    # --- Feedback (uses OpenAI) ---
    feedback_result: FeedbackResult | None = None
    if feedback_min_evidence(word_count) and question_text:
        try:
            feedback_result = generate_feedback(
                transcript=transcript_text,
                question_text=question_text,
                fluency_result=fluency_result,
                vocab_result=vocab_result,
                grammar_result=grammar_result,
                coherence_result=coherence_result,
                pron_result=pron_result,
                api_key=openai_api_key,
            )
        except FeedbackError as exc:
            log.warning("Feedback generation failed (non-fatal): %s", exc)
        except Exception as exc:
            log.warning("Feedback generation unexpected error (non-fatal): %s", exc)

    # --- Persist ---
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
        fluency_score=fluency_score,
        vocabulary_score=vocabulary_score,
        grammar_score=grammar_score,
        coherence_score=coherence_score,
        overall_score=overall_score,
        evidence={
            "whisper": transcript_result.raw,
            "azure_pa": pron_evidence,
            "fluency": fluency_result.raw
            if fluency_result
            else {"skipped": "insufficient_evidence"},
            "vocabulary": vocab_result.raw
            if vocab_result
            else {"skipped": "insufficient_evidence"},
            "grammar": grammar_result.raw
            if grammar_result
            else {"skipped": "insufficient_evidence"},
            "coherence": coherence_result.raw
            if coherence_result
            else {"skipped": "insufficient_evidence"},
            "feedback": feedback_result.raw
            if feedback_result
            else {"skipped": "insufficient_evidence"},
        },
    )
    db.add(assessment)
    db.flush()

    if feedback_result:
        for item in feedback_result.items:
            db.add(
                SpeakingFeedbackItem(
                    assessment_id=assessment.id,
                    category=item.category,
                    severity=item.severity,
                    original_text=item.original_text,
                    corrected_text=item.corrected_text,
                    explanation=item.explanation,
                )
            )

    session.status = "done"
    session.completed_at = now
    jobs_svc.complete(db, job)
    db.commit()


def _compute_overall(
    pronunciation: float | None,
    fluency: float | None,
    vocabulary: float | None,
    grammar: float | None,
    coherence: float | None,
) -> float | None:
    """Weighted average of available scores. Returns null if none are available."""
    weights = {
        "pronunciation": (pronunciation, 20.0),
        "fluency": (fluency, 20.0),
        "vocabulary": (vocabulary, 20.0),
        "grammar": (grammar, 20.0),
        "coherence": (coherence, 20.0),
    }
    total_weight = 0.0
    weighted_sum = 0.0
    for _name, (score, weight) in weights.items():
        if score is not None:
            weighted_sum += score * weight
            total_weight += weight

    if total_weight == 0:
        return None
    return round(weighted_sum / total_weight, 1)


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
