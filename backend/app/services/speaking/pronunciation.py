"""Azure AI Speech Pronunciation Assessment adapter.

Uses the speech-to-text REST API for short audio (no native SDK, so the worker stays pure
Python). What that API documents, and this module follows (Microsoft Learn, "Speech to text REST
API for short audio" and "Use pronunciation assessment"):

- Input is WAV PCM 16 kHz mono (or OGG Opus) only; `audio.to_wav_16k_mono` converts recordings.
- Pronunciation assessment audio "should be no more than 30 seconds".
- `ReferenceText` is required. For free speech Microsoft recommends transcribing first and then
  running a scripted assessment against that text, so free speech is cut into pieces at the
  speaker's pauses (`audio.plan_pieces`) and each piece is assessed against its own transcript.
- Prosody (stress, intonation, rhythm) is scored when `EnableProsodyAssessment` is "True"
  (en-US only).
- The REST response puts the scores directly on `NBest[0]` and on each word. The Speech SDK's JSON
  nests them in a `PronunciationAssessment` object; both shapes are read, the flat one first.

EU endpoint only (westeurope): audio must not leave the EU (Supabase is eu-north-1, Fly Stockholm).
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from app.services.speaking import audio as audio_mod
from app.services.speaking.fluency import is_filler
from app.services.speaking.transcription import TranscriptWord


@dataclass(frozen=True)
class PhonemeScore:
    phoneme: str
    accuracy_score: float


@dataclass(frozen=True)
class WordPronunciationScore:
    word: str
    accuracy_score: float
    # Azure error types: None | Mispronunciation | Omission | Insertion | UnexpectedBreak |
    # MissingBreak | Monotone.
    error_type: str
    phonemes: list[PhonemeScore]
    # Where Azure heard the word, in ms from the start of the whole recording (acoustic alignment,
    # far more exact than Whisper's word times); None for words it did not hear (Omission).
    start_ms: int | None = None
    end_ms: int | None = None
    # Azure's prosody judgement of the break before this word («UnexpectedBreak»), when given.
    break_error: str | None = None


@dataclass(frozen=True)
class PronunciationResult:
    accuracy_score: float
    fluency_score: float
    completeness_score: float
    pronunciation_score: float
    words: list[WordPronunciationScore]
    raw: dict[str, object]
    # Present only when Azure returned it (prosody is en-US only).
    prosody_score: float | None = field(default=None)


class PronunciationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# Minimum evidence for free speech (architecture plan §7).
MIN_WORDS_FOR_SCORE = 10
MIN_DURATION_MS_FOR_SCORE = 3_000
# Read aloud: a score needs at least this share of the sentence actually read (Azure completeness).
MIN_COMPLETENESS_FOR_SCORE = 50.0
# A read-aloud sentence takes seconds; anything past Azure's 30 s limit is silence or noise.
_MAX_READ_ALOUD_MS = 29_500


def meets_minimum_evidence(word_count: int, duration_ms: int) -> bool:
    """Free speech: enough words and time for a pronunciation score to mean something."""
    return word_count >= MIN_WORDS_FOR_SCORE and duration_ms >= MIN_DURATION_MS_FOR_SCORE


def read_aloud_has_evidence(result: PronunciationResult) -> bool:
    """Read aloud: the learner read at least half the sentence. A short sentence still counts."""
    return result.completeness_score >= MIN_COMPLETENESS_FOR_SCORE and bool(result.words)


def assess_read_aloud(
    wav: bytes, reference_text: str, api_key: str, region: str = "westeurope"
) -> PronunciationResult:
    """Scripted assessment of a read-aloud sentence: omissions and insertions are marked."""
    if audio_mod.duration_ms(wav) > _MAX_READ_ALOUD_MS:
        wav = audio_mod.slice_wav(wav, 0, _MAX_READ_ALOUD_MS)
    data = _call(wav, _params(reference_text, miscue=True), api_key, region)
    result = _parse(data)
    return _with_raw(result, {"mode": "read_aloud", "pieces": 1})


def assess_free_speech(
    wav: bytes,
    words: Sequence[TranscriptWord],
    total_ms: int,
    api_key: str,
    region: str = "westeurope",
) -> PronunciationResult:
    """Free speech: each pause-bounded piece (≤ 28 s) is assessed against its own transcript.

    Miscue marking is off: the reference is the learner's own words, so a word Azure hears
    differently from Whisper is a transcription disagreement, not a word the learner skipped."""
    pieces = audio_mod.plan_pieces(words, total_ms)
    results: list[tuple[PronunciationResult, int]] = []
    for piece in pieces:
        # Fillers ("um") are hesitations to count, not words whose pronunciation to score.
        reference = " ".join(
            w.word.strip() for w in words[piece.first : piece.last] if not is_filler(w.word)
        ).strip()
        if not reference:
            continue
        clip = audio_mod.slice_wav(wav, piece.start_ms, piece.end_ms)
        data = _call(clip, _params(reference, miscue=False), api_key, region)
        try:
            results.append((_shifted(_parse(data), piece.start_ms), piece.last - piece.first))
        except PronunciationError as exc:
            # A piece Azure heard nothing in (noise, a cough) is left out, not scored as zero.
            if exc.code != "no_speech":
                raise
    if not results:
        raise PronunciationError("no_speech", "Azure recognised no speech in the recording.")
    return _combine(results, len(pieces))


# ── HTTP ──────────────────────────────────────────────────────────────────────────


def _params(reference_text: str, *, miscue: bool) -> dict[str, str]:
    # Values as the REST documentation writes them: strings, booleans as "True"/"False".
    return {
        "ReferenceText": reference_text,
        "GradingSystem": "HundredMark",
        "Granularity": "Phoneme",
        "Dimension": "Comprehensive",
        "EnableMiscue": "True" if miscue else "False",
        "EnableProsodyAssessment": "True",
    }


def _call(wav: bytes, params: Mapping[str, str], api_key: str, region: str) -> dict[str, Any]:
    import httpx2 as httpx

    header = base64.b64encode(json.dumps(dict(params)).encode()).decode()
    url = (
        f"https://{region}.stt.speech.microsoft.com"
        "/speech/recognition/conversation/cognitiveservices/v1"
        "?language=en-US&format=detailed"
    )
    try:
        response = httpx.post(
            url,
            content=wav,
            headers={
                "Ocp-Apim-Subscription-Key": api_key,
                "Content-Type": audio_mod.WAV_CONTENT_TYPE,
                "Accept": "application/json",
                "Pronunciation-Assessment": header,
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
    if not isinstance(data, dict):
        raise PronunciationError("bad_response", "Azure PA returned an unexpected body.")
    return data


# ── Parsing ───────────────────────────────────────────────────────────────────────


def _scores(item: Mapping[str, Any]) -> Mapping[str, Any]:
    """The score fields of an NBest item, word or phoneme: flat (REST) or nested (SDK)."""
    nested = item.get("PronunciationAssessment")
    if isinstance(nested, Mapping) and "AccuracyScore" in nested:
        return nested
    return item


def _num(scores: Mapping[str, Any], key: str) -> float | None:
    value = scores.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _parse(data: Mapping[str, Any]) -> PronunciationResult:
    status = data.get("RecognitionStatus", "")
    if status in ("NoMatch", "InitialSilenceTimeout", "BabbleTimeout"):
        raise PronunciationError("no_speech", f"Azure heard no speech ({status}).")
    if status != "Success":
        raise PronunciationError("recognition_failed", f"Azure recognition status: {status}")
    nbest = data.get("NBest") or []
    if not nbest:
        raise PronunciationError("no_speech", "Azure returned no recognition result.")
    best = nbest[0]
    top = _scores(best)
    if _num(top, "AccuracyScore") is None:
        raise PronunciationError("bad_response", "Azure returned no pronunciation scores.")

    words: list[WordPronunciationScore] = []
    for w in best.get("Words") or []:
        ws = _scores(w)
        phonemes = [
            PhonemeScore(
                phoneme=str(ph.get("Phoneme", "")),
                accuracy_score=_num(_scores(ph), "AccuracyScore") or 0.0,
            )
            for ph in w.get("Phonemes") or []
        ]
        error_type = str(ws.get("ErrorType") or "None")
        offset, duration = _num(w, "Offset"), _num(w, "Duration")  # 100-nanosecond units
        heard = offset is not None and duration is not None and error_type != "Omission"
        words.append(
            WordPronunciationScore(
                word=str(w.get("Word", "")),
                accuracy_score=_num(ws, "AccuracyScore") or 0.0,
                error_type=error_type,
                phonemes=phonemes,
                start_ms=round(offset / 10_000) if heard and offset is not None else None,
                end_ms=round((offset + duration) / 10_000)
                if heard and offset is not None and duration is not None
                else None,
                break_error=_break_error(w),
            )
        )

    accuracy = _num(top, "AccuracyScore") or 0.0
    fluency = _num(top, "FluencyScore") or 0.0
    completeness = _num(top, "CompletenessScore") or 0.0
    prosody = _num(top, "ProsodyScore")
    pron = _num(top, "PronScore") or 0.0
    return PronunciationResult(
        accuracy_score=accuracy,
        fluency_score=fluency,
        completeness_score=completeness,
        pronunciation_score=pron,
        prosody_score=prosody,
        words=words,
        raw={
            "recognition_status": status,
            "recognized_text": best.get("Lexical") or best.get("Display") or "",
            "accuracy_score": accuracy,
            "fluency_score": fluency,
            "completeness_score": completeness,
            "prosody_score": prosody,
            "pronunciation_score": pron,
            "word_count": len(words),
            "snr": data.get("SNR"),
        },
    )


def _break_error(word: Mapping[str, Any]) -> str | None:
    """«UnexpectedBreak» / «MissingBreak» from a word's prosody feedback, if Azure gave one."""
    feedback = word.get("Feedback")
    prosody = feedback.get("Prosody") if isinstance(feedback, Mapping) else None
    brk = prosody.get("Break") if isinstance(prosody, Mapping) else None
    kinds = brk.get("ErrorTypes") if isinstance(brk, Mapping) else None
    if isinstance(kinds, list):
        for kind in kinds:
            if isinstance(kind, str) and kind not in ("None", ""):
                return kind
    return None


def _shifted(result: PronunciationResult, by_ms: int) -> PronunciationResult:
    """A piece's word times moved onto the whole recording's clock."""
    if by_ms == 0:
        return result
    words = [
        replace(
            w,
            start_ms=None if w.start_ms is None else w.start_ms + by_ms,
            end_ms=None if w.end_ms is None else w.end_ms + by_ms,
        )
        for w in result.words
    ]
    return replace(result, words=words)


def _with_raw(result: PronunciationResult, extra: dict[str, object]) -> PronunciationResult:
    return PronunciationResult(
        accuracy_score=result.accuracy_score,
        fluency_score=result.fluency_score,
        completeness_score=result.completeness_score,
        pronunciation_score=result.pronunciation_score,
        prosody_score=result.prosody_score,
        words=result.words,
        raw={**result.raw, **extra},
    )


def _combine(parts: list[tuple[PronunciationResult, int]], planned: int) -> PronunciationResult:
    """Scores of several pieces as one, each piece weighted by the words spoken in it."""

    def avg(get: Callable[[PronunciationResult], float | None]) -> float | None:
        pairs = [(v, n) for r, n in parts if (v := get(r)) is not None]
        weight = sum(n for _, n in pairs)
        return round(sum(v * n for v, n in pairs) / weight, 1) if weight else None

    accuracy = avg(lambda r: r.accuracy_score) or 0.0
    fluency = avg(lambda r: r.fluency_score) or 0.0
    completeness = avg(lambda r: r.completeness_score) or 0.0
    prosody = avg(lambda r: r.prosody_score)
    pron = avg(lambda r: r.pronunciation_score) or 0.0
    words = [w for r, _ in parts for w in r.words]
    return PronunciationResult(
        accuracy_score=accuracy,
        fluency_score=fluency,
        completeness_score=completeness,
        pronunciation_score=pron,
        prosody_score=prosody,
        words=words,
        raw={
            "mode": "free_speech",
            "pieces": planned,
            "pieces_scored": len(parts),
            "accuracy_score": accuracy,
            "fluency_score": fluency,
            "completeness_score": completeness,
            "prosody_score": prosody,
            "pronunciation_score": pron,
            "word_count": len(words),
            "recognized_text": " ".join(str(r.raw.get("recognized_text", "")) for r, _ in parts),
        },
    )
