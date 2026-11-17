"""Feedback generator via OpenAI (updated: removed DeepSeek dependency).

Produces 2–5 actionable feedback items and a one-sentence overall summary
from the full assessment evidence.

Non-negotiables:
- For 'pronunciation': only reference words where Azure PA flagged an error.
- For 'grammar': only reference errors from the grammar checker.
- For other categories: reference the numeric metrics; no invented text.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, field_validator

from app.services.speaking.coherence import CoherenceResult
from app.services.speaking.fluency import FluencyResult
from app.services.speaking.grammar import GrammarResult
from app.services.speaking.pronunciation import PronunciationResult
from app.services.speaking.vocabulary import VocabularyResult

log = logging.getLogger(__name__)

MIN_WORDS_FOR_FEEDBACK = 15

_SYSTEM = """\
You are an English-language examiner giving concise, encouraging feedback to L2 learners.

You will receive evidence gathered from automatic scoring tools. Your job is to generate:
1. A "summary": one sentence (max 20 words) summarising the student's overall performance.
2. "items": 2-5 specific, actionable feedback items based STRICTLY on the provided evidence.
   Never invent errors that are not in the evidence.

Rules for items:
  - For category "pronunciation": ONLY reference words listed in pronunciation_errors.
    If pronunciation_errors is empty, do NOT produce a pronunciation item.
  - For category "grammar": ONLY reference errors listed in grammar_errors.
    If grammar_errors is empty, do NOT produce a grammar item.
  - For category "vocabulary", "coherence", "fluency": reference the provided numeric metrics.
  - explanation must be one clear English sentence (<=20 words). Do not start with "I".
  - corrected_text is optional; use it only for grammar and pronunciation corrections.
  - Prioritise major errors first.

Return ONLY valid JSON (no markdown, no extra keys):
{
  "summary": "<one sentence overall assessment>",
  "items": [
    {
      "category": "pronunciation|grammar|vocabulary|coherence|fluency",
      "severity": "major|minor|info",
      "original_text": "<quoted span from transcript or null>",
      "corrected_text": "<correction or null>",
      "explanation": "<one sentence>"
    }
  ]
}
"""


class FeedbackItem(BaseModel):
    category: Literal["pronunciation", "grammar", "vocabulary", "coherence", "fluency"]
    severity: Literal["major", "minor", "info"]
    original_text: str | None = None
    corrected_text: str | None = None
    explanation: str

    @field_validator("explanation")
    @classmethod
    def explanation_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("explanation must not be empty")
        return v.strip()


class FeedbackResult:
    def __init__(self, items: list[FeedbackItem], summary: str, raw: dict[str, Any]) -> None:
        self.items = items
        self.summary = summary
        self.raw = raw


class FeedbackError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def meets_minimum_evidence(word_count: int) -> bool:
    return word_count >= MIN_WORDS_FOR_FEEDBACK


def generate_feedback(
    transcript: str,
    question_text: str,
    fluency_result: FluencyResult | None,
    vocab_result: VocabularyResult | None,
    grammar_result: GrammarResult | None,
    coherence_result: CoherenceResult | None,
    pron_result: PronunciationResult | None,
    api_key: str,
    model: str = "gpt-4o-mini",
    base_url: str | None = None,
) -> FeedbackResult:
    """Generate evidence-grounded feedback items using an OpenAI-compatible LLM.

    Raises FeedbackError on failure (non-fatal in orchestration)."""
    import openai

    evidence_parts: list[str] = []

    if pron_result is not None:
        problem_words = [w for w in pron_result.words if w.error_type not in ("None", "")]
        if problem_words:
            word_list = ", ".join(
                f"{w.word!r} (error: {w.error_type}, accuracy: {w.accuracy_score:.0f}%)"
                for w in problem_words[:8]
            )
            evidence_parts.append(f"pronunciation_errors: [{word_list}]")
        else:
            evidence_parts.append("pronunciation_errors: []")
    else:
        evidence_parts.append("pronunciation_errors: []  # not available")

    if grammar_result is not None and grammar_result.errors:

        def _fmt_error(e: Any) -> str:
            has_pos = e.offset >= 0 and e.length > 0
            snippet = transcript[e.offset : e.offset + e.length] if has_pos else "?"
            correction = e.replacements[0] if e.replacements else "?"
            return f'original={snippet!r}, correction={correction!r}, reason="{e.message}"'

        err_list = "; ".join(_fmt_error(e) for e in grammar_result.errors[:5])
        evidence_parts.append(f"grammar_errors: [{err_list}]")
    else:
        evidence_parts.append("grammar_errors: []")

    if fluency_result is not None:
        evidence_parts.append(
            f"fluency: wpm={fluency_result.wpm:.0f}, "
            f"pause_ratio={fluency_result.pause_ratio:.2f}, "
            f"score={fluency_result.score:.0f}/100"
        )
    else:
        evidence_parts.append("fluency: not available")

    if vocab_result is not None:
        dist = ", ".join(f"{k}:{v}" for k, v in sorted(vocab_result.cefr_distribution.items()))
        evidence_parts.append(
            f"vocabulary: score={vocab_result.score:.0f}/100, "
            f"unique_lemmas={vocab_result.unique_lemmas}, "
            f"cefr_distribution=[{dist}]"
        )
    else:
        evidence_parts.append("vocabulary: not available")

    if coherence_result is not None:
        evidence_parts.append(
            f"coherence: score={coherence_result.score:.0f}/100, "
            f'justification="{coherence_result.justification}"'
        )
    else:
        evidence_parts.append("coherence: not available")

    evidence_block = "\n".join(evidence_parts)
    prompt = f"Question: {question_text}\n\nTranscript: {transcript}\n\nEvidence:\n{evidence_block}"

    try:
        client = openai.OpenAI(api_key=api_key, base_url=base_url, timeout=30.0, max_retries=1)
        response = client.chat.completions.create(
            model=model,
            max_tokens=600,
            temperature=0.0,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
        )
    except Exception as exc:
        raise FeedbackError("api_error", f"LLM call failed: {exc}") from exc

    content = (response.choices[0].message.content or "").strip()
    if content.startswith("```"):
        content = "\n".join(content.split("\n")[1:-1])

    try:
        data = json.loads(content)
        summary = str(data.get("summary", "")).strip()
        raw_items = data.get("items", [])
        if not isinstance(raw_items, list):
            raise ValueError("items must be an array")
    except Exception as exc:
        raise FeedbackError("bad_response", f"LLM returned invalid JSON: {content!r}") from exc

    items: list[FeedbackItem] = []
    for raw in raw_items[:5]:
        try:
            items.append(FeedbackItem.model_validate(raw))
        except Exception as exc:
            log.debug("Skipping malformed feedback item: %s", exc)

    return FeedbackResult(
        items=items,
        summary=summary,
        raw={
            "model": model,
            "summary": summary,
            "item_count": len(items),
            "word_count": len(transcript.split()),
        },
    )
