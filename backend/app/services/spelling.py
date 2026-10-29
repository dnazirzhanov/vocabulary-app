"""Spelling with letter tiles (ADR 0016): pure rules. No database or HTTP here.

A spelling card shows a word's Russian meaning; the learner builds the English word from letter
tiles. Each of the day's new words gets one card; a word built right at the first try counts as
spelled right, and after a mistake the learner may build it again until it is right.

The tile bank holds one tile for every letter of the word (apple has two p tiles) and a few
letters that are not in it, arranged alphabetically so a letter is easy to find. The word may
not stand in the bank letter by letter; if alphabetical order happens to spell it, the bank is
shuffled instead.

A phrase (carry out, well-known) is built the same way: its spaces, hyphens and apostrophes are
fixed gaps between the slots, never tiles, and a hint names a slot among the letters only.
"""

import random
import string
import unicodedata

# Tiles in a bank: at least this many, and always room for this many letters not in the word.
MIN_TILES = 15
MIN_DISTRACTORS = 4
LETTERS = string.ascii_lowercase


def normalize(answer: str) -> str:
    """Forgive what is not spelling: case and surrounding spaces. Never a misspelling."""
    return unicodedata.normalize("NFKC", answer).strip().lower()


def is_correct(answer: str, target: str) -> bool:
    return normalize(answer) == normalize(target) != ""


def letters(target: str) -> str:
    """The letters to build, without a phrase's separators."""
    return "".join(letter for letter in normalize(target) if letter in LETTERS)


def separators(target: str) -> list[tuple[int, str]]:
    """A phrase's fixed gaps: (letters before it, the character)."""
    gaps: list[tuple[int, str]] = []
    count = 0
    for char in normalize(target):
        if char in LETTERS:
            count += 1
        else:
            gaps.append((count, char))
    return gaps


def tiles(target: str, rng: random.Random) -> list[str]:
    """The letter bank for `target`, in display order."""
    word = list(letters(target))
    absent = [letter for letter in LETTERS if letter not in word]
    count = max(MIN_TILES, len(word) + MIN_DISTRACTORS)
    bank = sorted(word + rng.sample(absent, count - len(word)))
    spelled = "".join(word)
    for _ in range(100):  # a passing order is found at once in practice
        if spelled not in "".join(bank):
            return bank
        rng.shuffle(bank)
    raise ValueError(f"no tile order hides {spelled!r}")
