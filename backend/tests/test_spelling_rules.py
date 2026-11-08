"""Spelling rules (ADR 0016): letter banks, answers and spelling cards."""

import random
from collections import Counter
from pathlib import Path

from app.services.content import parse_deck
from app.services.learning import PlannedExercise, plan_spelling
from app.services.spelling import is_correct, letters, separators, tiles

CONTENT = Path(__file__).resolve().parents[2] / "content"
LEVELS = ("a1-a2", "b1-b2", "c1")


def test_apple_has_two_separate_p_tiles() -> None:
    bank = tiles("apple", random.Random(1))
    assert Counter(bank)["p"] >= 2
    assert len(bank) == 15


def test_every_word_of_the_course_can_be_built_from_its_bank() -> None:
    for level in LEVELS:
        for word in parse_deck(CONTENT / level).words:
            bank = tiles(word.headword, random.Random(word.id))
            needed = Counter(word.headword)
            assert all(Counter(bank)[letter] >= n for letter, n in needed.items()), word.headword
            # Letters outside the word, at least four of them.
            assert sum(1 for letter in bank if letter not in needed) >= 4, word.headword
            assert len(bank) == max(15, len(word.headword) + 4)
            # The word never stands in the bank letter by letter.
            assert word.headword not in "".join(bank), word.headword


def test_the_bank_is_alphabetical_unless_that_spells_the_word() -> None:
    bank = tiles("house", random.Random(3))
    assert bank == sorted(bank)
    # "abc" sorts into itself: it must be shuffled out of order.
    assert "abc" not in "".join(tiles("abc", random.Random(0)))


def test_answers_forgive_case_and_spaces_never_a_misspelling() -> None:
    assert is_correct(" Apple ", "apple")
    assert not is_correct("aple", "apple")
    assert not is_correct("", "apple")


def test_a_phrase_is_built_from_letters_with_fixed_gaps() -> None:
    assert letters("carry out") == "carryout"
    assert separators("carry out") == [(5, " ")]
    assert separators("well-known") == [(4, "-")]
    assert separators("o'clock") == [(1, "'")]
    assert separators("house") == []
    bank = tiles("carry out", random.Random(2))
    assert " " not in bank and Counter(bank)["r"] >= 2
    assert is_correct("Carry out", "carry out")
    assert not is_correct("carryout", "carry out")


def bank(word_id: str, step_id: str) -> list[str]:
    return ["x"]


def test_one_spelling_card_per_word_in_the_order_learned() -> None:
    steps = plan_spelling(["apple", "house", "water"], bank)
    assert [(s.id, s.type, s.word_id) for s in steps] == [
        ("s1", "spelling", "apple"),
        ("s2", "spelling", "house"),
        ("s3", "spelling", "water"),
    ]
    assert PlannedExercise.from_json(steps[0].to_json()) == steps[0]


def test_a_one_letter_word_can_be_spelled() -> None:
    """«a» and «i» can be typed into a deck of one's own; their bank used to fail (ADR 0062
    found it: no order of tiles can hide a single letter)."""
    for word in ("a", "i"):
        bank = tiles(word, random.Random(0))
        assert word in bank and len(bank) == 15
