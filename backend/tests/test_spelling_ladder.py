"""The spelling ladder and the four sets of words (ADR 0026), without a database."""

import random
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.spelling_ladder import (
    HARD,
    KNOWN,
    Spelled,
    Words,
    after_spelling,
    overview,
    pick,
)

UTC_ZONE = ZoneInfo("UTC")
NOW = datetime(2026, 11, 2, 18, 0, tzinfo=UTC)
TODAY_START = datetime(2026, 11, 2, 0, 0, tzinfo=UTC)


def morning(days: int) -> datetime:
    """4 AM, `days` after today: when a word is due."""
    return datetime(2026, 11, 2, 4, 0, tzinfo=UTC) + timedelta(days=days)


def test_a_miss_is_hard_and_due_the_next_morning() -> None:
    for before in (None, Spelled(2, NOW, NOW - timedelta(days=7))):
        assert after_spelling(before, False, NOW, UTC_ZONE) == Spelled(HARD, morning(1), NOW)


def test_right_when_due_climbs_3_then_7_then_known() -> None:
    first = after_spelling(None, True, NOW, UTC_ZONE)
    assert first == Spelled(1, morning(3), NOW)
    second = after_spelling(first, True, morning(3), UTC_ZONE)
    assert (second.rung, second.due_at) == (2, morning(10))
    third = after_spelling(second, True, morning(10), UTC_ZONE)
    assert third.rung == KNOWN
    assert after_spelling(third, True, third.due_at, UTC_ZONE).rung == KNOWN
    # A hard word spelled right when due starts climbing again.
    assert after_spelling(Spelled(HARD, NOW, NOW), True, NOW, UTC_ZONE).rung == 1


def test_right_before_it_is_due_changes_nothing_but_the_time() -> None:
    hard = Spelled(HARD, morning(1), NOW - timedelta(hours=1))
    assert after_spelling(hard, True, NOW, UTC_ZONE) == Spelled(HARD, morning(1), NOW)


WORDS = Words(
    met=["a", "b", "c", "d", "e", "f", "g"],  # oldest first; e, f, g learned today
    today=["e", "f", "g"],
    ladder={
        "a": Spelled(KNOWN, morning(20), NOW),
        "b": Spelled(1, NOW - timedelta(hours=2), NOW - timedelta(days=3)),  # due
        "c": Spelled(HARD, NOW - timedelta(hours=1), NOW - timedelta(days=1)),  # due
        "f": Spelled(HARD, morning(1), TODAY_START + timedelta(hours=10)),  # missed today
    },
    today_start=TODAY_START,
)


def test_mix_takes_due_words_hardest_first_then_todays_then_older_never_spelled() -> None:
    rng = random.Random(1)
    assert pick("mix", 10, WORDS, NOW, rng) == ["c", "b", "e", "g", "d"]
    assert pick("mix", 3, WORDS, NOW, rng) == ["c", "b", "e"]


def test_today_puts_words_not_yet_spelled_today_first() -> None:
    assert pick("today", 10, WORDS, NOW, random.Random(1)) == ["e", "g", "f"]


def test_hard_is_the_bottom_rung_due_first() -> None:
    assert pick("hard", 10, WORDS, NOW, random.Random(1)) == ["c", "f"]


def test_a_word_on_the_ladder_counts_without_having_been_met() -> None:
    """A group's test can put a word there before any lesson meets it (ADR 0048)."""
    words = Words(
        met=["a"],
        today=[],
        ladder={"t": Spelled(HARD, NOW - timedelta(hours=1), NOW - timedelta(days=1))},
        today_start=TODAY_START,
    )
    assert pick("hard", 10, words, NOW, random.Random(1)) == ["t"]
    assert pick("mix", 10, words, NOW, random.Random(1)) == ["t", "a"]
    seen = overview(words, NOW)
    assert (seen.hard, seen.due, seen.met) == (1, 1, 1)
    # Words never met stay out of the draw from everything met.
    assert pick("random", 10, words, NOW, random.Random(1)) == ["a"]


def test_random_favours_words_never_spelled_and_rarely_a_known_one() -> None:
    first: dict[str, int] = {}
    for seed in range(3000):
        drawn = pick("random", 3, WORDS, NOW, random.Random(seed))
        assert len(set(drawn)) == 3 and set(drawn) <= set(WORDS.met)
        first[drawn[0]] = first.get(drawn[0], 0) + 1
    assert first["d"] > first["b"] > first["a"]  # never spelled > climbing > known


def test_the_overview_counts_what_each_button_holds() -> None:
    seen = overview(WORDS, NOW)
    assert (seen.ready, seen.due, seen.today, seen.today_left) == (5, 2, 3, 2)
    assert (seen.hard, seen.known, seen.met) == (2, 1, 7)
