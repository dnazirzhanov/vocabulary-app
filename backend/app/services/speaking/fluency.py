"""Fluency metrics derived purely from Whisper word timestamps (Chunk 5).

No external API calls — all deterministic from the transcript_words list.

Scoring rationale (L2 English research):
  - Native conversational English: 120–180 WPM.
  - Fluent L2 speakers: 90–150 WPM.
  - Pausing: fluent speech has pause_ratio ≤ 0.20 (pauses < 20% of total time).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.speaking.transcription import TranscriptWord

MIN_WORDS_FOR_FLUENCY = 8
MIN_DURATION_MS_FOR_FLUENCY = 4_000

# A gap between consecutive words ≥ this value counts as a hesitation pause.
_PAUSE_THRESHOLD_MS = 500
_IDEAL_WPM_LOW = 90.0
_IDEAL_WPM_HIGH = 150.0
# pause_ratio above this triggers a fluency penalty
_PAUSE_IDEAL_MAX = 0.20


@dataclass(frozen=True)
class FluencyResult:
    wpm: float
    pause_ratio: float
    pause_count: int
    speaking_ms: int  # total time minus hesitation pauses
    score: float  # 0–100
    raw: dict[str, object]


def meets_minimum_evidence(word_count: int, duration_ms: int) -> bool:
    return word_count >= MIN_WORDS_FOR_FLUENCY and duration_ms >= MIN_DURATION_MS_FOR_FLUENCY


def compute_fluency(words: list[TranscriptWord], total_duration_ms: int) -> FluencyResult:
    """Derive fluency metrics from Whisper word timestamps."""
    if not words or total_duration_ms <= 0:
        return FluencyResult(
            wpm=0.0,
            pause_ratio=0.0,
            pause_count=0,
            speaking_ms=0,
            score=0.0,
            raw={"note": "no_data"},
        )

    pause_ms = 0
    pause_count = 0
    for i in range(1, len(words)):
        gap = words[i].start_ms - words[i - 1].end_ms
        if gap >= _PAUSE_THRESHOLD_MS:
            pause_ms += gap
            pause_count += 1

    speaking_ms = max(total_duration_ms - pause_ms, 1)
    wpm = len(words) / (total_duration_ms / 60_000)
    pause_ratio = pause_ms / total_duration_ms

    # WPM component: 100 in ideal range, linear fall-off outside it.
    if _IDEAL_WPM_LOW <= wpm <= _IDEAL_WPM_HIGH:
        wpm_score = 100.0
    elif wpm < _IDEAL_WPM_LOW:
        wpm_score = max(30.0, 100.0 - (_IDEAL_WPM_LOW - wpm) * 1.5)
    else:
        wpm_score = max(60.0, 100.0 - (wpm - _IDEAL_WPM_HIGH) * 0.8)

    # Pause penalty: each percentage point above ideal subtracts ~1.5 from score.
    pause_penalty = max(0.0, (pause_ratio - _PAUSE_IDEAL_MAX) * 150)
    score = max(0.0, min(100.0, wpm_score - pause_penalty))

    return FluencyResult(
        wpm=round(wpm, 1),
        pause_ratio=round(pause_ratio, 3),
        pause_count=pause_count,
        speaking_ms=speaking_ms,
        score=round(score, 1),
        raw={
            "wpm": round(wpm, 1),
            "pause_ratio": round(pause_ratio, 3),
            "pause_count": pause_count,
            "speaking_ms": speaking_ms,
            "word_count": len(words),
            "total_ms": total_duration_ms,
        },
    )
