"""Grammar checking via OpenAI GPT when LanguageTool is not configured.

Uses gpt-4o-mini with temperature=0 and strict JSON output.
Returns the same GrammarResult / GrammarError dataclasses as grammar.py so
the orchestration layer can use either implementation transparently.

Non-negotiable: errors must reference exact phrases present in the transcript.
The LLM is instructed never to invent errors.
"""

from __future__ import annotations

import json
import logging

from app.services.speaking.grammar import GrammarError, GrammarResult

log = logging.getLogger(__name__)

_SYSTEM = """\
You are an English grammar checker for L2 learner spoken transcripts.

Your ONLY task: identify clear grammatical errors in the transcript.
Focus on: subject-verb agreement, tense, articles, prepositions, singular/plural forms,
word order, pronoun agreement.

Do NOT flag:
- Punctuation or capitalisation (this is a spoken transcript, not writing)
- Style or word choice (vocabulary is assessed separately)
- Filler words, repetitions, or hesitations
- Anything that is a matter of preference rather than clear grammatical error

For each error you must:
1. Quote the EXACT phrase from the transcript verbatim as "original"
2. Provide the corrected form as "corrected"
3. Give a one-sentence explanation (max 15 words) as "explanation"
4. Label the category as one of: GRAMMAR | AGREEMENT | TENSE | ARTICLE | PREPOSITION | VERB

Return ONLY valid JSON (no markdown, no extra keys):
{
  "errors": [
    {"original": "...", "corrected": "...", "explanation": "...", "category": "..."}
  ],
  "score": <integer 0-100>
}

Score rubric (apply yourself, do not ask):
  100 = no errors
  Subtract 15 per major error (affects meaning), 8 per minor error
  Minimum score is 0

If the transcript has no grammatical errors, return: {"errors": [], "score": 100}
"""


def check_grammar_llm(
    transcript: str,
    api_key: str,
    model: str = "gpt-4o-mini",
) -> GrammarResult:
    """Check grammar using an OpenAI LLM.

    Returns the same GrammarResult interface as grammar.py.
    Raises GrammarError_ (from grammar.py) on failure."""
    import openai

    from app.services.speaking.grammar import GrammarError_

    word_count = len(transcript.split())

    try:
        client = openai.OpenAI(api_key=api_key, timeout=30.0, max_retries=1)
        response = client.chat.completions.create(
            model=model,
            max_tokens=512,
            temperature=0.0,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"Transcript:\n{transcript}"},
            ],
        )
    except Exception as exc:
        raise GrammarError_("api_error", f"OpenAI grammar check failed: {exc}") from exc

    content = (response.choices[0].message.content or "").strip()
    if content.startswith("```"):
        content = "\n".join(content.split("\n")[1:-1])

    try:
        data = json.loads(content)
        raw_errors = data.get("errors", [])
        llm_score = float(data.get("score", 100))
    except Exception as exc:
        raise GrammarError_("bad_response", f"OpenAI returned invalid JSON: {content!r}") from exc

    llm_score = max(0.0, min(100.0, llm_score))

    errors: list[GrammarError] = []
    for e in raw_errors[:8]:
        original = str(e.get("original", "")).strip()
        corrected = str(e.get("corrected", "")).strip()
        explanation = str(e.get("explanation", "")).strip()
        category = str(e.get("category", "GRAMMAR")).strip()

        if not original or not explanation:
            continue

        # Only include if original phrase actually appears in the transcript.
        if original.lower() not in transcript.lower():
            log.debug("Grammar LLM invented error not in transcript: %r", original)
            continue

        offset = transcript.lower().find(original.lower())
        errors.append(
            GrammarError(
                message=explanation,
                offset=max(0, offset),
                length=len(original),
                replacements=[corrected] if corrected else [],
                rule_id="llm_grammar",
                category=category,
            )
        )

    return GrammarResult(
        errors=errors,
        error_count=len(errors),
        score=round(llm_score, 1),
        raw={
            "error_count": len(errors),
            "word_count": word_count,
            "model": model,
            "source": "llm",
        },
    )
