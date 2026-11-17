"""Coherence assessment via OpenAI (updated: removed DeepSeek dependency).

Asks the LLM to rate how coherent and on-topic the student's answer is,
given the original question.

Non-negotiable: the LLM rates COHERENCE only. It must not invent grammar or
pronunciation errors — those come from their respective evidence providers.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

MIN_WORDS_FOR_COHERENCE = 20

_SYSTEM = """\
You are a neutral English-language examiner scoring spoken answers by L2 learners.

Your ONLY task is to rate COHERENCE AND RELEVANCE of the answer to the given question.
Coherence = logical flow, topic focus, and clear communication of ideas.
Do NOT assess pronunciation, grammar, or vocabulary — those are scored separately.

Respond ONLY with valid JSON matching this exact schema (no markdown, no extra keys):
{"score": <integer 0-100>, "justification": "<one concise English sentence>"}

Scoring guide:
  90–100: fully coherent, directly answers the question, well-organised
  70–89:  mostly on-topic with minor digressions or unclear points
  50–69:  partially relevant; some coherent ideas but significant off-topic content
  30–49:  mostly off-topic or hard to follow
  0–29:   incoherent or completely unrelated to the question
"""


@dataclass(frozen=True)
class CoherenceResult:
    score: float
    justification: str
    raw: dict[str, object]


class CoherenceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def meets_minimum_evidence(word_count: int) -> bool:
    return word_count >= MIN_WORDS_FOR_COHERENCE


def assess_coherence(
    transcript: str,
    question_text: str,
    api_key: str,
    model: str = "gpt-4o-mini",
    base_url: str | None = None,
) -> CoherenceResult:
    """Score coherence of a spoken answer using an OpenAI-compatible LLM.

    Raises CoherenceError on failure (non-fatal in orchestration)."""
    import openai

    prompt = f"Question: {question_text}\n\nStudent answer (verbatim transcript): {transcript}"

    try:
        client = openai.OpenAI(api_key=api_key, base_url=base_url, timeout=30.0, max_retries=1)
        response = client.chat.completions.create(
            model=model,
            max_tokens=120,
            temperature=0.0,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
        )
    except Exception as exc:
        raise CoherenceError("api_error", f"LLM call failed: {exc}") from exc

    content = (response.choices[0].message.content or "").strip()
    if content.startswith("```"):
        content = "\n".join(content.split("\n")[1:-1])

    try:
        data = json.loads(content)
        score = float(data["score"])
        justification = str(data["justification"])
    except Exception as exc:
        raise CoherenceError(
            "bad_response", f"LLM returned invalid JSON: {content!r}"
        ) from exc

    score = max(0.0, min(100.0, score))

    return CoherenceResult(
        score=round(score, 1),
        justification=justification,
        raw={
            "score": score,
            "justification": justification,
            "model": model,
            "word_count": len(transcript.split()),
        },
    )
