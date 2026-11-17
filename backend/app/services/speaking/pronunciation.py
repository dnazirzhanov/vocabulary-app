"""Azure AI Speech Pronunciation Assessment adapter (Chunk 4).

Uses the REST API directly (no native SDK) so the worker stays pure-Python.
EU endpoint only: audio must NOT leave the EU (GDPR — Supabase is eu-north-1,
Fly is Stockholm, Azure endpoint is westeurope).

Reference:
  https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text
  https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class PhonemeScore:
    phoneme: str
    accuracy_score: float


@dataclass(frozen=True)
class WordPronunciationScore:
    word: str
    accuracy_score: float
    # Azure error types: None | Insertion | Mispronunciation | Missing | UnexpectedBreak |
    # MissingBreak | Monotone (or empty string for no error)
    error_type: str
    phonemes: list[PhonemeScore]


@dataclass(frozen=True)
class PronunciationResult:
    accuracy_score: float
    fluency_score: float
    completeness_score: float
    pronunciation_score: float
    words: list[WordPronunciationScore]
    raw: dict[str, object]


class PronunciationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# Minimum evidence to report a pronunciation score (architecture plan §7).
MIN_WORDS_FOR_SCORE = 10
MIN_DURATION_MS_FOR_SCORE = 3_000


def meets_minimum_evidence(word_count: int, duration_ms: int) -> bool:
    return word_count >= MIN_WORDS_FOR_SCORE and duration_ms >= MIN_DURATION_MS_FOR_SCORE


def assess(
    audio_bytes: bytes,
    mime_type: str,
    reference_text: str,
    api_key: str,
    region: str = "westeurope",
) -> PronunciationResult:
    """Submit audio to Azure PA and return structured results.

    Raises PronunciationError on API failure or unrecognised audio."""
    import httpx2 as httpx

    pa_config = base64.b64encode(
        json.dumps(
            {
                "ReferenceText": reference_text,
                "GradingSystem": "HundredMark",
                "Dimension": "Comprehensive",
            }
        ).encode()
    ).decode()

    url = (
        f"https://{region}.stt.speech.microsoft.com"
        "/speech/recognition/conversation/cognitiveservices/v1"
        "?language=en-US&format=detailed&profanity=masked"
    )

    # Strip codecs parameter — Azure wants just the base MIME type.
    content_type = mime_type.split(";", 1)[0].strip()

    try:
        response = httpx.post(
            url,
            content=audio_bytes,
            headers={
                "Ocp-Apim-Subscription-Key": api_key,
                "Content-Type": content_type,
                "Pronunciation-Assessment": pa_config,
            },
            timeout=60.0,
        )
    except Exception as exc:
        raise PronunciationError("connection_error", f"Azure PA connection failed: {exc}") from exc

    if response.status_code == 401:
        raise PronunciationError("auth_failed", "Azure Speech key rejected.")
    if response.status_code == 429:
        raise PronunciationError("rate_limited", "Azure Speech rate limit reached.")
    if response.status_code >= 400:
        raise PronunciationError("api_error", f"Azure Speech API error: {response.status_code}")

    try:
        data = response.json()
    except Exception as exc:
        raise PronunciationError("bad_response", "Azure PA returned non-JSON.") from exc

    status = data.get("RecognitionStatus", "")
    if status not in ("Success", "NoMatch"):
        raise PronunciationError("recognition_failed", f"Azure recognition status: {status}")

    nbest = data.get("NBest") or []
    if not nbest:
        raise PronunciationError("no_result", "Azure PA returned no NBest candidates.")

    best = nbest[0]
    pa = best.get("PronunciationAssessment") or {}

    words: list[WordPronunciationScore] = []
    for w in best.get("Words") or []:
        w_pa = w.get("PronunciationAssessment") or {}
        phonemes: list[PhonemeScore] = []
        for ph in w.get("Phonemes") or []:
            ph_pa = ph.get("PronunciationAssessment") or {}
            phonemes.append(
                PhonemeScore(
                    phoneme=ph.get("Phoneme", ""),
                    accuracy_score=float(ph_pa.get("AccuracyScore", 0)),
                )
            )
        words.append(
            WordPronunciationScore(
                word=w.get("Word", ""),
                accuracy_score=float(w_pa.get("AccuracyScore", 0)),
                error_type=w_pa.get("ErrorType") or "None",
                phonemes=phonemes,
            )
        )

    raw: dict[str, object] = {
        "recognition_status": status,
        "accuracy_score": pa.get("AccuracyScore"),
        "fluency_score": pa.get("FluencyScore"),
        "completeness_score": pa.get("CompletenessScore"),
        "pronunciation_score": pa.get("PronScore"),
        "word_count": len(words),
    }

    return PronunciationResult(
        accuracy_score=float(pa.get("AccuracyScore") or 0),
        fluency_score=float(pa.get("FluencyScore") or 0),
        completeness_score=float(pa.get("CompletenessScore") or 0),
        pronunciation_score=float(pa.get("PronScore") or 0),
        words=words,
        raw=raw,
    )
