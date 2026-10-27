"""Spelling rules (ADR 0016): letter banks, answers and the spelling review schedule."""

import random
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.services.content import parse_deck
from app.services.learning import PlannedExercise, after_miss, plan_spelling
from app.services.spelling import INTERVALS, is_correct, next_review, tiles

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


def test_the_schedule_grows_after_first_try_recalls_and_starts_over_after_a_miss() -> None:
    zone = ZoneInfo("Asia/Bishkek")
    today = date(2026, 11, 2)
    stage = 0
    gaps = []
    for _ in range(6):
        stage, due = next_review(stage, True, today, zone)
        gaps.append((due.date() - today).days)
    assert gaps == [*INTERVALS, INTERVALS[-1]]
    stage, due = next_review(stage, False, today, zone)
    assert (stage, due) == (0, datetime(2026, 11, 3, tzinfo=zone))
    assert due.astimezone(UTC).hour == 18  # the start of the learner's next day


def bank(word_id: str, step_id: str) -> list[str]:
    return ["x"]


def test_guided_comes_first_and_each_recall_waits_for_other_exercises() -> None:
    steps = plan_spelling(["apple", "house", "water"], ["cat"], 6, bank)
    assert [(s.type, s.word_id) for s in steps] == [
        ("spell_guided", "apple"),
        ("spell_guided", "house"),
        ("spell_guided", "water"),
        ("spell_recall", "cat"),
        ("spell_recall", "apple"),
        ("spell_recall", "house"),
        ("spell_recall", "water"),
    ]
    assert [s.id for s in steps] == [f"s{n}" for n in range(6, 13)]
    recall = steps.index(
        next(s for s in steps if s.type == "spell_recall" and s.word_id == "apple")
    )
    assert recall - 0 - 1 >= 2  # at least two exercises between apple's guided and recall


def test_a_miss_brings_guided_practice_and_one_retry_never_more() -> None:
    plan = [PlannedExercise(f"s{n}", "spell_recall", w) for n, w in enumerate("abcd", start=1)]
    first, inserted = after_miss(plan, 0, plan[0], bank, gap=2)
    assert [(s.type, s.word_id, s.retry) for s in first[:5]] == [
        ("spell_recall", "a", False),
        ("spell_guided", "a", False),
        ("spell_recall", "b", False),
        ("spell_recall", "c", False),
        ("spell_recall", "a", True),
    ]
    assert [index for index, _ in inserted] == [1, 4]
    retry = first[4]
    second, inserted = after_miss(first, 4, retry, bank, gap=2)
    assert [s.type for _, s in inserted] == ["spell_guided"]  # no third recall: the lesson ends
    assert len({s.id for s in second}) == len(second)
