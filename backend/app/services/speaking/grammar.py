"""Grammar checking via the LanguageTool REST API (Chunk 5).

Calls the configured LANGUAGE_TOOL_URL (e.g. https://api.languagetool.org/v2/check).
If the URL is not set in config, grammar checking is skipped and grammar_score stays null.

Using the LanguageTool REST API directly with httpx2 avoids the language-tool-python
package (which bundles a 350 MB JRE). Point to a self-hosted instance in production
(docker.io/erikvl87/languagetool is the standard Fly-compatible image).
"""

from __future__ import annotations

from dataclasses import dataclass, field

MIN_WORDS_FOR_GRAMMAR = 5

# Error categories from LanguageTool that we care about for L2 speaking assessment.
# Style/typography/whitespace are irrelevant for spoken transcripts.
_RELEVANT_CATEGORIES = {
    "GRAMMAR",
    "TYPOS",  # real word errors (not typos, but transcription may surface them)
    "SEMANTICS",
    "AGREEMENT",
    "VERB",
    "ARTICLE",
    "PREPOSITION",
    "PRONOUN",
    "TENSE",
    "CONFUSED_WORDS",
    "REDUNDANCY",
}

# How many errors per word are "acceptable" before the score drops significantly.
_ERRORS_PER_WORD_FOR_50 = 0.10  # 10% error rate → ~50/100


@dataclass(frozen=True)
class GrammarError:
    message: str
    offset: int
    length: int
    replacements: list[str]
    rule_id: str
    category: str


@dataclass(frozen=True)
class GrammarResult:
    errors: list[GrammarError] = field(default_factory=list)
    error_count: int = 0
    score: float = 0.0
    raw: dict[str, object] = field(default_factory=dict)


class GrammarError_(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def meets_minimum_evidence(word_count: int) -> bool:
    return word_count >= MIN_WORDS_FOR_GRAMMAR


def check_grammar(transcript: str, url: str, word_count: int) -> GrammarResult:
    """Call LanguageTool and return a GrammarResult.

    Raises GrammarError_ on network or API failure (non-fatal in orchestration)."""
    import httpx2 as httpx

    try:
        response = httpx.post(
            f"{url.rstrip('/')}/check",
            data={"language": "en-US", "text": transcript},
            headers={"Accept": "application/json"},
            timeout=30.0,
        )
    except Exception as exc:
        raise GrammarError_("connection_error", f"LanguageTool unreachable: {exc}") from exc

    if response.status_code >= 400:
        raise GrammarError_("api_error", f"LanguageTool HTTP {response.status_code}")

    try:
        data = response.json()
    except Exception as exc:
        raise GrammarError_("bad_response", "LanguageTool returned non-JSON") from exc

    errors: list[GrammarError] = []
    for match in data.get("matches") or []:
        cat = (match.get("rule") or {}).get("category") or {}
        cat_id = cat.get("id", "")
        if cat_id not in _RELEVANT_CATEGORIES:
            continue
        replacements = [r.get("value", "") for r in (match.get("replacements") or [])[:3]]
        errors.append(
            GrammarError(
                message=match.get("message", ""),
                offset=match.get("offset", 0),
                length=match.get("length", 0),
                replacements=replacements,
                rule_id=(match.get("rule") or {}).get("id", ""),
                category=cat_id,
            )
        )

    # Score: 100 for zero errors, falls as error_rate rises.
    error_density = len(errors) / max(word_count, 1)
    score = max(0.0, min(100.0, 100.0 - (error_density / _ERRORS_PER_WORD_FOR_50) * 50))

    return GrammarResult(
        errors=errors,
        error_count=len(errors),
        score=round(score, 1),
        raw={
            "error_count": len(errors),
            "word_count": word_count,
            "error_density": round(error_density, 4),
            "language_tool_url": url,
        },
    )
