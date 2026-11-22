"""Whisper adapter for the speaking pipeline.

Uses openai.audio.transcriptions.create with verbose_json + word timestamps so we get
word-level timing. The raw transcript is NEVER corrected here — corrections go in
speaking_feedback_items (Chunk 6).

The caller passes audio bytes; this module does not touch the database.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TranscriptWord:
    word: str
    start_ms: int
    end_ms: int
    confidence: float


@dataclass(frozen=True)
class TranscriptResult:
    transcript: str
    words: list[TranscriptWord]
    duration_ms: int
    # Raw response dict for the evidence column (scrubbed of large binary fields).
    raw: dict[str, object]


class TranscriptionError(Exception):
    """Raised when Whisper rejects the audio or the API call fails."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


FILLER_PROMPT = "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking."


def transcribe(audio_bytes: bytes, mime_type: str, api_key: str) -> TranscriptResult:
    """Submit `audio_bytes` to OpenAI Whisper and return a TranscriptResult.

    Raises TranscriptionError on API failure or if the audio is unusable."""
    import openai

    # Whisper needs a filename with the right extension for format detection.
    ext = _ext_for(mime_type)
    filename = f"recording{ext}"

    client = openai.OpenAI(api_key=api_key, timeout=60.0)
    try:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=(filename, audio_bytes, mime_type),
            response_format="verbose_json",
            timestamp_granularities=["word"],
            language="en",
            # Whisper tends to drop hesitations ("um", "uh"), which hides exactly what fluency is
            # about. OpenAI's speech-to-text guide lists "preserving ... filler words" as a use of
            # the prompt; a prompt that itself contains fillers nudges the transcript to keep them.
            prompt=FILLER_PROMPT,
        )
    except openai.AuthenticationError as exc:
        raise TranscriptionError("auth_failed", "Whisper authentication failed.") from exc
    except openai.RateLimitError as exc:
        raise TranscriptionError("rate_limited", "Whisper rate limit reached.") from exc
    except openai.APIStatusError as exc:
        raise TranscriptionError("api_error", f"Whisper API error: {exc.status_code}") from exc
    except openai.APIConnectionError as exc:
        raise TranscriptionError("connection_error", "Could not connect to Whisper.") from exc

    words: list[TranscriptWord] = []
    # verbose_json puts word timestamps in response.words (may be absent for empty audio).
    raw_words = getattr(response, "words", None) or []
    for w in raw_words:
        words.append(
            TranscriptWord(
                word=w.word,
                start_ms=int(w.start * 1000),
                end_ms=int(w.end * 1000),
                confidence=float(getattr(w, "probability", 1.0)),
            )
        )

    duration_s = getattr(response, "duration", None)
    duration_ms = int(duration_s * 1000) if duration_s is not None else _estimate_duration(words)

    raw = {
        "model": "whisper-1",
        "language": getattr(response, "language", None),
        "duration_s": duration_s,
        "word_count": len(words),
    }

    return TranscriptResult(
        transcript=response.text.strip(),
        words=words,
        duration_ms=duration_ms,
        raw=raw,
    )


def _ext_for(mime_type: str) -> str:
    primary = mime_type.split(";", 1)[0].strip()
    return {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
    }.get(primary, ".webm")


def _estimate_duration(words: list[TranscriptWord]) -> int:
    if not words:
        return 0
    return words[-1].end_ms
