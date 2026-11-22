"""Pauses and filled pauses («um», «uh») found in the audio itself, not only in the transcript.

Why: Whisper drops most fillers, even when prompted to keep them, and its word times stretch words
over the silences between them, so a fluency measure built on Whisper alone sees neither. Here:

1. Word times come from Azure's acoustic alignment when available (exact), else from Whisper.
2. A simple voice-activity detector marks each 20 ms of the 16 kHz WAV as sound or silence, with a
   threshold set from this recording's own noise floor and speech level.
3. Between two words:
   - silence of SILENT_MIN_MS or more is a pause (LONG_MS or more: a long one);
   - sound of FILLED_MIN_MS or more that no word covers is a filled pause (an «um», «er», a false
     start) — whether or not the transcript has it.
   Whisper's own filler tokens are added where the audio did not already show one.
4. A pause is *inside a phrase* unless it follows the end of a sentence or clause in the transcript
   (. , ! ? ; :) or comes right before a linking word («and», «because», «so» …). Pausing between
   ideas is natural; pausing inside a phrase, while searching for a word, is what costs fluency.

No network, no database: numbers in, numbers out.
"""

from __future__ import annotations

import io
import itertools
import wave
from dataclasses import dataclass
from typing import Literal

import numpy as np

from app.services.speaking.fluency import is_filler

FRAME_MS = 20
SILENT_MIN_MS = 250
LONG_MS = 1_000
FILLED_MIN_MS = 150
_EDGE_MS = 40  # word boundaries are not exact to the frame: ignore sound this close to a word

LINKERS = frozenset(
    {
        "and", "but", "so", "because", "or", "then", "well", "also", "although", "though",
        "however", "when", "while", "if", "which", "that", "after", "before", "since", "actually",
        "anyway", "first", "firstly", "secondly", "finally", "besides", "therefore", "like",
    }
)  # fmt: skip


@dataclass(frozen=True)
class TimedWord:
    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class Pause:
    start_ms: int
    end_ms: int
    kind: Literal["silent", "filled"]
    inside_phrase: bool
    before: str  # the word before the pause ('' at the start)
    after: str  # the word after it

    @property
    def ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass(frozen=True)
class Hesitations:
    pauses: list[Pause]
    words: int  # spoken words, fillers excluded
    span_ms: int  # first word's start to last word's end
    source: Literal["azure", "whisper"]
    audio: bool  # whether the audio itself was analysed (False: word gaps only)

    @property
    def silent(self) -> list[Pause]:
        return [p for p in self.pauses if p.kind == "silent"]

    @property
    def filled(self) -> list[Pause]:
        return [p for p in self.pauses if p.kind == "filled"]


# ── Voice activity ────────────────────────────────────────────────────────────────


def voiced_frames(wav: bytes) -> np.ndarray:
    """One bool per 20 ms frame: is there speech-like sound (relative to this recording)?"""
    with wave.open(io.BytesIO(wav), "rb") as w:
        rate = w.getframerate()
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)
    size = rate * FRAME_MS // 1000
    n = len(samples) // size
    if n == 0:
        return np.zeros(0, dtype=bool)
    frames = samples[: n * size].reshape(n, size)
    db = 20 * np.log10(np.sqrt(np.mean(frames**2, axis=1)) + 1e-9)
    floor, peak = np.percentile(db, 10), np.percentile(db, 95)
    # Sound is anything clearly above this recording's quiet parts: a third of the way to its
    # loud parts, and at least 8 dB over the floor (so a silent recording has no "speech").
    threshold = max(floor + 8.0, floor + (peak - floor) / 3)
    voiced: np.ndarray = db > threshold
    return voiced


def _runs(mask: np.ndarray, value: bool, lo: int, hi: int) -> list[tuple[int, int]]:
    """Frame ranges [start, end) in mask[lo:hi] equal to value."""
    out: list[tuple[int, int]] = []
    start = None
    for i in range(max(lo, 0), min(hi, len(mask))):
        if bool(mask[i]) == value:
            if start is None:
                start = i
        elif start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, min(hi, len(mask))))
    return out


# ── Analysis ──────────────────────────────────────────────────────────────────────


def analyse(
    words: list[TimedWord],
    *,
    transcript_words: list[TimedWord] | None = None,
    wav: bytes | None = None,
    source: Literal["azure", "whisper"] = "whisper",
) -> Hesitations:
    """Find the pauses between `words` (timed, in order); `transcript_words` (Whisper's, with
    punctuation and fillers) say where sentences end and where Whisper heard a filler."""
    spoken = sorted(
        (w for w in words if not is_filler(w.text) and w.end_ms > w.start_ms),
        key=lambda w: w.start_ms,
    )
    said = transcript_words or []
    if not spoken:
        return Hesitations([], 0, 0, source, wav is not None)

    voiced = voiced_frames(wav) if wav else None
    pauses: list[Pause] = []
    for prev, nxt in itertools.pairwise(spoken):
        gap_start, gap_end = prev.end_ms, nxt.start_ms
        if gap_end - gap_start < min(SILENT_MIN_MS, FILLED_MIN_MS):
            continue
        inside = _inside_phrase(prev, nxt, said)
        if voiced is None:
            if gap_end - gap_start >= SILENT_MIN_MS:
                pauses.append(
                    Pause(gap_start, gap_end, "silent", inside, _bare(prev.text), _bare(nxt.text))
                )
            continue
        lo = (gap_start + _EDGE_MS) // FRAME_MS
        hi = (gap_end - _EDGE_MS) // FRAME_MS
        for a, b in _runs(voiced, False, lo, hi):
            if (b - a) * FRAME_MS >= SILENT_MIN_MS:
                pauses.append(
                    Pause(
                        a * FRAME_MS,
                        b * FRAME_MS,
                        "silent",
                        inside,
                        _bare(prev.text),
                        _bare(nxt.text),
                    )
                )
        for a, b in _runs(voiced, True, lo, hi):
            if (b - a) * FRAME_MS >= FILLED_MIN_MS:
                pauses.append(
                    Pause(
                        a * FRAME_MS,
                        b * FRAME_MS,
                        "filled",
                        inside,
                        _bare(prev.text),
                        _bare(nxt.text),
                    )
                )

    # Fillers Whisper did write down, where the audio did not already show a filled pause.
    for w in said:
        if not is_filler(w.text):
            continue
        mid = (w.start_ms + w.end_ms) // 2
        if any(p.kind == "filled" and p.start_ms - 100 <= mid <= p.end_ms + 100 for p in pauses):
            continue
        before = max((s for s in spoken if s.end_ms <= mid), key=lambda s: s.end_ms, default=None)
        after = min(
            (s for s in spoken if s.start_ms >= mid), key=lambda s: s.start_ms, default=None
        )
        inside = before is not None and after is not None and _inside_phrase(before, after, said)
        pauses.append(
            Pause(
                w.start_ms,
                max(w.end_ms, w.start_ms + FILLED_MIN_MS),
                "filled",
                inside,
                _bare(before.text) if before else "",
                _bare(after.text) if after else "",
            )
        )

    pauses.sort(key=lambda p: p.start_ms)
    return Hesitations(
        pauses=pauses,
        words=len(spoken),
        span_ms=spoken[-1].end_ms - spoken[0].start_ms,
        source=source,
        audio=voiced is not None,
    )


def _bare(word: str) -> str:
    return word.strip().strip(".,!?;:…\"'«»()").lower()


def _inside_phrase(prev: TimedWord, nxt: TimedWord, said: list[TimedWord]) -> bool:
    """False when the pause falls where a speaker naturally breathes: after a sentence or clause
    ends, or before a linking word."""
    if _bare(nxt.text) in LINKERS:
        return False
    # Punctuation lives in Whisper's words: the one ending nearest the aligned word's end.
    near = min(said, key=lambda w: abs(w.end_ms - prev.end_ms), default=None)
    ends_clause = (
        near is not None
        and abs(near.end_ms - prev.end_ms) <= 400
        and near.text.rstrip()[-1:] in ".,!?;:"
    )
    return not ends_clause


# ── Fluency score ───────────────────────────────────────────────────────────────


def _band(value: float, worst: float, best: float) -> float:
    """0 at `worst`, 1 at `best`, straight in between (either direction)."""
    if best == worst:
        return 1.0
    return max(0.0, min(1.0, (value - worst) / (best - worst)))


def fluency_score(
    h: Hesitations, azure_fluency: float | None = None
) -> tuple[float, dict[str, object]]:
    """0–100 from four measures of fluency in L2 speech (speech rate, silent pauses, filled pauses,
    length of runs between pauses), averaged with Azure's own fluency score when there is one.

    Bands (a first calibration, not examiner-validated): speech rate 60→130 words a minute; silent
    pauses 24→6 a minute, a pause inside a phrase counting double; filled pauses 12→2 a minute;
    mean run 3→10 words between pauses."""
    minutes = max(h.span_ms, 1) / 60_000
    rate = h.words / minutes
    silent_weighted = sum(2 if p.inside_phrase else 1 for p in h.silent) / minutes
    filled = len(h.filled) / minutes
    run = h.words / (len(h.pauses) + 1)
    parts = {
        "rate": _band(rate, 60, 130),
        "silent": _band(silent_weighted, 24, 6),
        "filled": _band(filled, 12, 2),
        "run": _band(run, 3, 10),
    }
    ours = 100 * sum(parts.values()) / len(parts)
    score = ours if azure_fluency is None else (ours + azure_fluency) / 2
    evidence: dict[str, object] = {
        "wpm": round(rate, 1),
        "silent_pauses": len(h.silent),
        "long_pauses": sum(1 for p in h.silent if p.ms >= LONG_MS),
        "pauses_inside_phrase": sum(1 for p in h.silent if p.inside_phrase),
        "filled_pauses": len(h.filled),
        "mean_run_words": round(run, 1),
        "parts": {k: round(v, 2) for k, v in parts.items()},
        "our_score": round(ours, 1),
        "azure_fluency": azure_fluency,
        "timing_source": h.source,
        "audio_analysed": h.audio,
        "pauses": [
            {
                "start_ms": p.start_ms,
                "ms": p.ms,
                "kind": p.kind,
                "inside_phrase": p.inside_phrase,
                "before": p.before,
                "after": p.after,
            }
            for p in h.pauses
        ],
    }
    return round(score, 1), evidence
