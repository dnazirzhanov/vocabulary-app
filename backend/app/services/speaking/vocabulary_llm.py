"""Vocabulary evidence from an LLM: what counting words cannot see.

The score comes from vocabulary.py (deterministic). This asks the model only for evidence,
every item quoting the learner's own words:

- misused: a word or phrase used wrongly («make a photo» → «take a photo»);
- overused: a word repeated where variety would help, with alternatives that fit the context;
- strong: a well-chosen word or phrase worth keeping.

An item whose quote is not in the transcript (or, for «overused», not said at least twice) is
dropped: the model may not invent evidence. Same OpenAI client and model as grammar_llm.py.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

MAX_MISUSED, MAX_OVERUSED, MAX_STRONG = 5, 3, 3
# Each confirmed misuse costs this much of the vocabulary score, up to the cap.
MISUSE_PENALTY, MISUSE_PENALTY_CAP = 3.0, 15.0

_SYSTEM = """\
You review the VOCABULARY of a spoken answer by an English learner (a raw speech transcript).
Do not comment on grammar, pronunciation or fillers.
Be strict and specific; do not praise generously.

Return ONLY JSON:
{
  "misused": [{"quote": "...", "better": "...", "why": "..."}],
  "overused": [{"quote": "...", "alternatives": ["...", "..."], "why": "..."}],
  "strong": [{"quote": "...", "why": "..."}]
}

Rules:
- "quote" is copied EXACTLY from the transcript (a word or a short phrase, at most 6 words).
- misused: a clearly wrong word choice or collocation (meaning or usage), not a grammar slip. Max 5.
- overused: a single word said several times where a varied choice would sound better. Give 2-3
  alternatives that fit how the learner used it. Max 3.
- strong: words or phrases above basic level, used correctly and naturally. Max 3.
- "why": one plain sentence, at most 15 words.
- Empty lists when there is nothing clear. Never invent quotes."""


@dataclass(frozen=True)
class VocabularyEvidence:
    misused: list[dict[str, str]] = field(default_factory=list)
    overused: list[dict[str, object]] = field(default_factory=list)
    strong: list[dict[str, str]] = field(default_factory=list)

    @property
    def penalty(self) -> float:
        return min(MISUSE_PENALTY_CAP, MISUSE_PENALTY * len(self.misused))

    def as_dict(self) -> dict[str, object]:
        return {"misused": self.misused, "overused": self.overused, "strong": self.strong}


class VocabularyLLMError(Exception):
    pass


def _occurrences(quote: str, transcript: str) -> int:
    """How often the quote is said, as whole words, ignoring case."""
    if not quote.strip():
        return 0
    return len(
        re.findall(rf"(?<!\w){re.escape(quote.strip())}(?!\w)", transcript, flags=re.IGNORECASE)
    )


def validate(data: object, transcript: str) -> VocabularyEvidence:
    """Keep only well-formed items that quote the transcript; the model may not invent evidence."""
    if not isinstance(data, dict):
        return VocabularyEvidence()

    def items(key: str) -> list[dict[str, object]]:
        value = data.get(key)
        return [i for i in value if isinstance(i, dict)] if isinstance(value, list) else []

    def text(item: dict[str, object], key: str) -> str:
        value = item.get(key)
        return value.strip() if isinstance(value, str) else ""

    misused = [
        {"quote": text(i, "quote"), "better": text(i, "better"), "why": text(i, "why")}
        for i in items("misused")
        if _occurrences(text(i, "quote"), transcript) >= 1
        and text(i, "better")
        and text(i, "better").lower() != text(i, "quote").lower()
    ][:MAX_MISUSED]
    overused: list[dict[str, object]] = []
    for i in items("overused"):
        given = i.get("alternatives")
        alts = (
            [a.strip() for a in given if isinstance(a, str) and a.strip()]
            if isinstance(given, list)
            else []
        )
        if _occurrences(text(i, "quote"), transcript) >= 2 and alts:
            overused.append(
                {"quote": text(i, "quote"), "alternatives": alts[:3], "why": text(i, "why")}
            )
    strong = [
        {"quote": text(i, "quote"), "why": text(i, "why")}
        for i in items("strong")
        if _occurrences(text(i, "quote"), transcript) >= 1
    ][:MAX_STRONG]
    return VocabularyEvidence(misused=misused, overused=overused[:MAX_OVERUSED], strong=strong)


def find_vocabulary_evidence(
    transcript: str, api_key: str, model: str = "gpt-4o-mini"
) -> VocabularyEvidence:
    """Ask the model for evidence, then keep only what the transcript supports."""
    import openai

    try:
        client = openai.OpenAI(api_key=api_key, timeout=30.0, max_retries=1)
        response = client.chat.completions.create(
            model=model,
            max_tokens=700,
            temperature=0.0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"Transcript:\n{transcript}"},
            ],
        )
    except Exception as exc:
        raise VocabularyLLMError(f"OpenAI vocabulary review failed: {exc}") from exc
    content = (response.choices[0].message.content or "").strip()
    try:
        return validate(json.loads(content), transcript)
    except json.JSONDecodeError as exc:
        raise VocabularyLLMError("OpenAI returned invalid JSON") from exc
