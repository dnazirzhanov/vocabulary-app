"""Vocabulary of a spoken answer: which levels its words come from, and how varied they are.

Deterministic, so the same answer always gets the same score, and every number is explainable:

- **Level profile.** Each content word (noun, verb, adjective, adverb) is looked up by lemma and
  part of speech in the CEFR-J Wordlist (A1–B2) and the Octanove profile (C1–C2); see
  data/ATTRIBUTION.md.
  Words in neither list (names, numbers, mis-transcriptions) are *off-list*: reported, never counted
  as advanced (the old scorer counted every unknown word as C1).
- **Diversity.** MATTR (moving-average type-token ratio, window 25): unlike a plain type-token ratio
  it does not fall just because an answer is longer.
- **Repetition.** Content words said three times or more.

The LLM (vocabulary_llm.py) only adds evidence quoted from the answer: misused words, overused words
with alternatives, well-chosen phrases. It does not set this score.
"""

from __future__ import annotations

import csv
import functools
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.services.speaking.fluency import is_filler

# Minimum evidence: a profile of fewer words says little about anyone's vocabulary.
MIN_WORDS_FOR_VOCABULARY = 40
MIN_CONTENT_WORDS = 20

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
_DATA = Path(__file__).with_name("data")
_POS = {"NOUN": "noun", "VERB": "verb", "ADJ": "adjective", "ADV": "adverb"}
_MATTR_WINDOW = 25

# How the measures become a 0–100 score. Set for *speech*, which uses far fewer rare words than
# writing (most spoken content words are A1–A2 even for fluent speakers): full marks for range at a
# weighted B1+ share of 25 % (B1 counts 0.6, B2 1.0, C1+ 1.4), and for variety at MATTR 0.90.
# A first calibration, not examiner-validated; tests/test_speaking_vocabulary.py pins its ordering.
_SOPHISTICATION_FULL = 0.25
_MATTR_LOW, _MATTR_HIGH = 0.40, 0.90
_WEIGHT_SOPHISTICATION, _WEIGHT_DIVERSITY = 0.6, 0.4


@dataclass(frozen=True)
class VocabularyResult:
    word_count: int  # content words profiled
    unique_lemmas: int
    cefr_distribution: dict[str, int]  # {"A1": n, ...} over on-list content words
    score: float | None  # 0–100; None when there is too little to judge
    raw: dict[str, object]


def meets_minimum_evidence(word_count: int) -> bool:
    return word_count >= MIN_WORDS_FOR_VOCABULARY


@functools.cache
def _lexicon() -> tuple[dict[tuple[str, str], str], dict[str, str]]:
    """(lemma, pos) → level and lemma → lowest level, from both lists; the easier level wins."""
    by_pos: dict[tuple[str, str], str] = {}
    by_lemma: dict[str, str] = {}

    def easier(old: str | None, level: str) -> bool:
        return old is None or LEVELS.index(level) < LEVELS.index(old)

    def add(word: str, pos: str, level: str) -> None:
        if level not in LEVELS or " " in word or not word:
            return
        pos = "verb" if pos == "vern" else pos  # a typo in the Octanove file
        if easier(by_pos.get((word, pos)), level):
            by_pos[(word, pos)] = level
        if easier(by_lemma.get(word), level):
            by_lemma[word] = level

    for name in ("cefrj-vocabulary-profile-1.5.csv", "octanove-vocabulary-profile-c1c2-1.0.csv"):
        with (_DATA / name).open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                for variant in row["headword"].split("/"):
                    add(variant.strip().lower(), row["pos"].strip(), row["CEFR"].strip())
    return by_pos, by_lemma


def level_of(lemma: str, pos: str, surface: str = "") -> str | None:
    """A word's CEFR level: by lemma and part of speech, then by lemma, then by its base form."""
    by_pos, by_lemma = _lexicon()
    lemma = lemma.lower()
    found = by_pos.get((lemma, pos)) or by_lemma.get(lemma)
    if found:
        return found
    # Lists hold base words: «biased» is listed as «bias», «carefully» as «careful».
    for word in {lemma, surface.lower()} - {""}:
        for base in _bases(word):
            if base in by_lemma:
                return by_lemma[base]
    return None


def _bases(word: str) -> list[str]:
    """Possible base forms of a derived word, most likely first."""
    out: list[str] = []
    for suffix, adds in (
        ("ly", ("",)),
        ("ed", ("", "e")),
        ("ing", ("", "e")),
        ("er", ("",)),
        ("est", ("",)),
    ):
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            stem = word[: -len(suffix)]
            out += [stem + a for a in adds]
            if len(stem) > 2 and stem[-1] == stem[-2]:  # «stopped» → «stop»
                out.append(stem[:-1])
            if stem.endswith("i"):  # «happily» → «happy»
                out.append(stem[:-1] + "y")
    return out


def mattr(tokens: list[str], window: int = _MATTR_WINDOW) -> float:
    """Moving-average type-token ratio; a plain TTR when the answer is shorter than the window."""
    if not tokens:
        return 0.0
    if len(tokens) <= window:
        return len(set(tokens)) / len(tokens)
    counts = Counter(tokens[:window])
    total = len(counts)
    for i in range(window, len(tokens)):
        out, inn = tokens[i - window], tokens[i]
        counts[out] -= 1
        if counts[out] == 0:
            del counts[out]
        counts[inn] += 1
        total += len(counts)
    # The mean, over every window, of that window's distinct words / window length.
    return total / (len(tokens) - window + 1) / window


def compute_vocabulary(transcript: str) -> VocabularyResult:
    """Profile the content words of a transcript and score range and variety."""
    doc = _get_nlp()(transcript)
    lemmas: list[str] = []
    levels: list[str] = []
    off_list: list[str] = []
    for token in doc:
        pos = _POS.get(token.pos_)
        if pos is None or not token.is_alpha or len(token.text) < 2 or is_filler(token.text):
            continue
        lemma = token.lemma_.lower()
        lemmas.append(lemma)
        level = level_of(lemma, pos, token.text)
        if level is None:
            off_list.append(token.text)
        else:
            levels.append(level)

    dist = {lvl: levels.count(lvl) for lvl in LEVELS if lvl in levels}
    on_list = len(levels)

    def share(*of: str) -> float:
        return sum(dist.get(x, 0) for x in of) / on_list if on_list else 0.0

    basic, b1, b2, c = share("A1", "A2"), share("B1"), share("B2"), share("C1", "C2")
    diversity = mattr(lemmas)
    # Overused words: basic ones ("good", "very", "thing") are exactly the ones worth noticing.
    repeated = [w for w, n in Counter(lemmas).most_common() if n >= 3][:5]
    advanced = sorted(
        {
            t.text.lower()
            for t in doc
            if _POS.get(t.pos_) and level_of(t.lemma_, _POS[t.pos_]) in ("B2", "C1", "C2")
        }
    )[:8]

    enough = len(lemmas) >= MIN_CONTENT_WORDS and on_list > 0
    score: float | None = None
    if enough:
        sophistication = min(1.0, (b1 * 0.6 + b2 * 1.0 + c * 1.4) / _SOPHISTICATION_FULL)
        variety = min(1.0, max(0.0, (diversity - _MATTR_LOW) / (_MATTR_HIGH - _MATTR_LOW)))
        score = round(
            100 * (_WEIGHT_SOPHISTICATION * sophistication + _WEIGHT_DIVERSITY * variety), 1
        )

    return VocabularyResult(
        word_count=len(lemmas),
        unique_lemmas=len(set(lemmas)),
        cefr_distribution=dist,
        score=score,
        raw={
            "content_words": len(lemmas),
            "unique_lemmas": len(set(lemmas)),
            "cefr_distribution": dist,
            "profile": {
                "A1-A2": round(basic, 3),
                "B1": round(b1, 3),
                "B2": round(b2, 3),
                "C1+": round(c, 3),
            },
            "mattr": round(diversity, 3),
            "repeated": repeated,
            "advanced_words": advanced,
            "off_list": sorted(set(off_list))[:10],
            **({} if enough else {"skipped": "insufficient_evidence"}),
        },
    )


_nlp: Any = None


def _get_nlp() -> Any:
    """spaCy's English model, loaded once per process (a pinned dependency, see pyproject.toml)."""
    global _nlp
    if _nlp is None:
        import spacy

        _nlp = spacy.load("en_core_web_sm", disable=["parser", "ner"])
    return _nlp
