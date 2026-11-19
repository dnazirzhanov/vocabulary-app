"""Audio preparation for Azure Pronunciation Assessment.

Azure's speech-to-text REST API for short audio accepts only WAV (PCM, 16 kHz, mono) or OGG Opus,
and for pronunciation assessment the audio "should be no more than 30 seconds" (Microsoft Learn,
"Speech to text REST API for short audio"). Browsers record WebM/Opus (Chrome, Android WebView) or
MP4/AAC (Safari), so every recording is converted once with ffmpeg, and longer free speech is cut
into pieces at the speaker's own pauses.

No database or network access here.
"""

from __future__ import annotations

import io
import subprocess
import wave
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

SAMPLE_RATE = 16_000
# Content-Type Azure documents for WAV input.
WAV_CONTENT_TYPE = "audio/wav; codecs=audio/pcm; samplerate=16000"
# Azure's limit is 30 s; keep a margin for the silence kept around each piece.
MAX_PIECE_MS = 28_000
# Silence kept before and after a piece so the first and last words are not clipped.
_PAD_MS = 150


class AudioConversionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def to_wav_16k_mono(audio_bytes: bytes, *, timeout_s: float = 60.0) -> bytes:
    """Any recording the app accepts → WAV, 16-bit PCM, 16 kHz, mono.

    Raises AudioConversionError when ffmpeg is missing or cannot read the audio."""
    try:
        # A fixed argument list and no shell; the recording only ever reaches ffmpeg's stdin.
        done = subprocess.run(  # noqa: S603
            [  # noqa: S607 - ffmpeg is found on PATH (installed in the Docker image)
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-sample_fmt",
                "s16",
                "-f",
                "wav",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=timeout_s,
            check=False,
        )
    except FileNotFoundError as exc:
        raise AudioConversionError("ffmpeg_missing", "ffmpeg is not installed.") from exc
    except subprocess.TimeoutExpired as exc:
        raise AudioConversionError("timeout", "Audio conversion took too long.") from exc
    if done.returncode != 0 or not done.stdout:
        detail = done.stderr.decode(errors="replace").strip()[:200]
        raise AudioConversionError("unreadable", f"ffmpeg could not read the audio: {detail}")
    # ffmpeg writing to a pipe cannot seek back to fill in the header's sizes; rewrite it.
    return _rewrap(done.stdout)


def _rewrap(wav_bytes: bytes) -> bytes:
    """Re-encode a WAV whose header may carry placeholder sizes into a well-formed one."""
    data_at = wav_bytes.find(b"data")
    if not wav_bytes.startswith(b"RIFF") or data_at == -1:
        raise AudioConversionError("unreadable", "ffmpeg returned no WAV data.")
    pcm = wav_bytes[data_at + 8 :]
    pcm = pcm[: len(pcm) - (len(pcm) % 2)]
    return _wav(pcm)


def _wav(pcm: bytes) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return out.getvalue()


def _pcm(wav_bytes: bytes) -> bytes:
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, SAMPLE_RATE):
            raise AudioConversionError("bad_format", "Expected 16 kHz mono 16-bit WAV.")
        return w.readframes(w.getnframes())


def duration_ms(wav_bytes: bytes) -> int:
    return len(_pcm(wav_bytes)) * 1000 // (SAMPLE_RATE * 2)


def slice_wav(wav_bytes: bytes, start_ms: int, end_ms: int) -> bytes:
    """The part of a 16 kHz mono WAV between two times, as its own WAV."""
    pcm = _pcm(wav_bytes)
    lo = max(0, start_ms) * SAMPLE_RATE // 1000 * 2
    hi = min(len(pcm), max(0, end_ms) * SAMPLE_RATE // 1000 * 2)
    return _wav(pcm[lo:hi])


@dataclass(frozen=True)
class Piece:
    """A stretch of free speech short enough for one Azure call."""

    start_ms: int
    end_ms: int
    # Indices into the transcript's word list: words[first:last] are spoken in this piece.
    first: int
    last: int


class _Timed(Protocol):
    @property
    def start_ms(self) -> int: ...
    @property
    def end_ms(self) -> int: ...


def plan_pieces(words: Sequence[_Timed], total_ms: int, max_ms: int = MAX_PIECE_MS) -> list[Piece]:
    """Cut speech into pieces of at most `max_ms`, each ending at the longest pause available.

    Cutting inside a pause, never inside a word, keeps every word whole in exactly one piece."""
    pieces: list[Piece] = []
    first = 0
    n = len(words)
    while first < n:
        start = max(0, words[first].start_ms - _PAD_MS)
        # The furthest word that still fits.
        last = first + 1
        while last < n and words[last].end_ms + _PAD_MS - start <= max_ms:
            last += 1
        if last < n and last - first > 1:
            # Not the end: cut at the longest pause between words first..last.
            gaps = [(words[i].start_ms - words[i - 1].end_ms, i) for i in range(first + 1, last)]
            # Prefer a pause in the later half, so pieces are not needlessly short.
            later = [g for g in gaps if g[1] - first >= (last - first) // 2] or gaps
            last = max(later)[1]
        end = (
            min(total_ms, words[last - 1].end_ms + _PAD_MS) if total_ms else words[last - 1].end_ms
        )
        pieces.append(Piece(start_ms=start, end_ms=max(end, start + 1), first=first, last=last))
        first = last
    return pieces
