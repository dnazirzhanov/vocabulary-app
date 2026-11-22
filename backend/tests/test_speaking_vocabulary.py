"""Vocabulary of spoken answers: CEFR profile, variety, and evidence the LLM may not invent."""

import random
import statistics
from pathlib import Path

import pytest
import yaml

from app.services.speaking.vocabulary import (
    MIN_CONTENT_WORDS,
    compute_vocabulary,
    level_of,
    mattr,
)
from app.services.speaking.vocabulary_llm import validate

CONTENT = Path(__file__).resolve().parents[2] / "content"

REPETITIVE_A1 = (
    "I like my city. My city is good. It is very good. I like the food. The food is good. "
    "I have friends. My friends are good. We go to the park. The park is nice. "
    "I like the park. My house is big. My house is nice. I like my house. "
    "My family is good. I like my family very much."
)
FLUENT_B2 = (
    "If I were to describe my hometown, I'd say that it is easily one of the best places "
    "in the world. Well, obviously I'm biased because I was born there and I love my "
    "country, my home city. Because I've got lots of relatives, friends, and my beloved "
    "people living in there. Therefore, I appreciate it. So, if I were to describe my "
    "typical morning routine, I'd say that I try to wake up as early as possible, "
    "sometimes as early as 4am, however, I don't succeed in that very often, I have to "
    "admit. After waking up, before having breakfast, I like to warm my body up by doing "
    "my physical exercise."
)


def test_words_are_levelled_by_the_cefr_lists() -> None:
    assert level_of("house", "noun") == "A1"
    assert level_of("abandon", "verb") == "B1"
    assert level_of("timid", "adjective") == "C1"  # Octanove C1/C2
    # Derived forms find their base word: «carefully» → «careful».
    assert level_of("carefully", "adverb", "carefully") is not None


def test_unknown_words_are_off_list_not_advanced() -> None:
    """The old scorer counted every word it did not know as C1: names and typos inflated scores."""
    base = compute_vocabulary(FLUENT_B2)
    # Names are proper nouns: not profiled at all.
    named = compute_vocabulary(FLUENT_B2 + " Then Aibek drove to Bishkek with Zyxlotan.")
    assert "Zyxlotan" not in named.raw["off_list"]  # type: ignore[operator]
    # A word in no list (a mis-transcription, say) is off-list, never C1.
    typo = compute_vocabulary(FLUENT_B2 + " The zyxlotan was quite flimbering.")
    assert "zyxlotan" in typo.raw["off_list"]  # type: ignore[operator]
    for r in (base, named, typo):
        assert r.cefr_distribution.get("C1", 0) + r.cefr_distribution.get("C2", 0) == 0


def test_mattr_matches_hand_computed_values() -> None:
    assert mattr(list("abcab")) == pytest.approx(3 / 5)  # shorter than the window: plain TTR
    # Window 3 over a b c a b: windows abc, bca, cab → 1, 1, 1.
    assert mattr(list("abcab"), window=3) == pytest.approx(1.0)
    # Window 2 over a a b b: aa, ab, bb → 0.5, 1, 0.5.
    assert mattr(list("aabb"), window=2) == pytest.approx(2 / 3)


def test_mattr_does_not_fall_just_because_an_answer_is_longer() -> None:
    varied = ["apple", "bread", "cheese", "dinner", "egg", "fish"]
    varied += ["grape", "honey", "island", "juice", "kettle", "lemon"]
    assert mattr(varied * 2, window=12) == pytest.approx(mattr(varied * 6, window=12), abs=0.01)


def test_too_little_to_judge_gets_no_score() -> None:
    r = compute_vocabulary("I like films. They are good.")
    assert r.score is None
    assert r.word_count < MIN_CONTENT_WORDS
    assert r.raw["skipped"] == "insufficient_evidence"


def test_repetition_is_reported() -> None:
    r = compute_vocabulary(REPETITIVE_A1)
    repeated = r.raw["repeated"]
    assert isinstance(repeated, list)
    assert {"good", "like"} <= set(repeated)


def test_scores_rise_with_level() -> None:
    """Calibration: a repetitive A1 answer < a fluent B2 answer; the app's own example sentences
    by level score in rising order."""
    a1 = compute_vocabulary(REPETITIVE_A1).score
    b2 = compute_vocabulary(FLUENT_B2).score
    assert a1 is not None and b2 is not None
    assert a1 < 25 < 50 < b2

    def median_for(deck: str) -> float:
        words = yaml.safe_load((CONTENT / deck / "words.yaml").read_text())
        examples = [w["example"] for w in words if w.get("example")]
        random.Random(1).shuffle(examples)
        scores = [
            compute_vocabulary(" ".join(examples[i : i + 12])).score for i in range(0, 96, 12)
        ]
        return statistics.median(s for s in scores if s is not None)

    assert median_for("a1-a2") < median_for("b1-b2") <= median_for("c1")


# ── Evidence from the LLM: kept only when the transcript supports it ──────────────


TRANSCRIPT = (
    "I made a photo of the sea. The sea was good and the food was good and the hotel was good."
)


def test_evidence_must_quote_the_transcript() -> None:
    ev = validate(
        {
            "misused": [
                {"quote": "made a photo", "better": "took a photo", "why": "We take photos."},
                {
                    "quote": "did a mistake",
                    "better": "made a mistake",
                    "why": "Invented: not said.",
                },
            ],
            "overused": [
                {
                    "quote": "good",
                    "alternatives": ["calm", "delicious", "comfortable"],
                    "why": "Said 3 times.",
                },
                {"quote": "sea", "alternatives": [], "why": "No alternatives: dropped."},
            ],
            "strong": [{"quote": "breathtaking view", "why": "Invented."}],
        },
        TRANSCRIPT,
    )
    assert [m["quote"] for m in ev.misused] == ["made a photo"]
    assert [o["quote"] for o in ev.overused] == ["good"]
    assert ev.strong == []
    assert ev.penalty == 3.0


def test_overused_needs_at_least_two_uses_and_whole_words() -> None:
    ev = validate(
        {"overused": [{"quote": "hotel", "alternatives": ["inn"], "why": ""}]}, TRANSCRIPT
    )
    assert ev.overused == []  # said once
    ev = validate({"misused": [{"quote": "hot", "better": "warm", "why": ""}]}, TRANSCRIPT)
    assert ev.misused == []  # only inside «hotel»


def test_malformed_answers_give_no_evidence() -> None:
    assert validate("not a dict", TRANSCRIPT).as_dict() == {
        "misused": [],
        "overused": [],
        "strong": [],
    }
    assert validate({"misused": "nope", "overused": [1, None]}, TRANSCRIPT).misused == []


def test_the_misuse_penalty_is_capped() -> None:
    many = {"misused": [{"quote": "made a photo", "better": f"x{i}", "why": ""} for i in range(9)]}
    assert validate(many, TRANSCRIPT).penalty == 15.0
