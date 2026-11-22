"""How a mentor answer is scored against a scenario's expectations (ADR 0075). Pure, so CI can
check the scoring itself without a model."""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

CYRILLIC = re.compile(r"[А-Яа-яЁё]")
LATIN = re.compile(r"[A-Za-z]")


@dataclass
class Outcome:
    """What the mentor did: the tools it called with their cards, and its text."""

    tools: list[str] = field(default_factory=list)
    cards: list[Mapping[str, Any] | None] = field(default_factory=list)
    text: str = ""


def language_of(text: str) -> str:
    """ru or en, by which letters dominate; markdown and numbers don't count."""
    cyr, lat = len(CYRILLIC.findall(text)), len(LATIN.findall(text))
    return "ru" if cyr >= lat else "en"


def score(expect: Mapping[str, Any], outcome: Outcome) -> list[str]:
    """The expectations not met, in words; an empty list passes."""
    misses: list[str] = []
    wanted: Sequence[str] = expect.get("tools_any", [])
    if wanted and not set(wanted) & set(outcome.tools):
        misses.append(f"expected one of {list(wanted)}, called {outcome.tools}")
    for word in expect.get("mentions", []):
        if word.lower() not in outcome.text.lower():
            misses.append(f"the answer doesn't mention {word!r}")
    limit = expect.get("activity_cards_max")
    if limit is not None:
        shown = [c for c in outcome.cards if c and c.get("type") == "activity"]
        if len(shown) > limit:
            misses.append(f"{len(shown)} activity cards, at most {limit}")
    language = expect.get("language")
    if language and outcome.text.strip() and language_of(outcome.text) != language:
        misses.append(f"answered in {language_of(outcome.text)}, not {language}")
    allowed = expect.get("no_numbers_except")
    if allowed is not None:
        numbers = set(re.findall(r"\d+", outcome.text)) - set(allowed)
        if numbers:
            misses.append(f"numbers no tool gave: {sorted(numbers)}")
    return misses
