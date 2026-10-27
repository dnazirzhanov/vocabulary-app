"""Spelling with letter tiles (ADR 0016): pure rules. No database or HTTP here.

Two exercises use the same tiles. *Guided*: the English word is shown and the learner builds it,
to look closely at its spelling. *Recall*: only the Russian meaning is shown and the learner
builds the word from memory. Only a recall built right at the first try, without asking to see
the word, counts as recalled; guided practice never does.

The tile bank holds one tile for every letter of the word (apple has two p tiles) and a few
letters that are not in it, arranged alphabetically so a letter is easy to find. The word may
not stand in the bank letter by letter; if alphabetical order happens to spell it, the bank is
shuffled instead.
"""

import random
import string
import unicodedata
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

# Tiles in a bank: at least this many, and always room for this many letters not in the word.
MIN_TILES = 15
MIN_DISTRACTORS = 4
# Recall of a word comes after at least this many other exercises when the lesson allows.
RECALL_GAP = 2
# Spelling reviews due on a later day, at most this many per lesson.
REVIEWS_PER_SESSION = 10
# Days until the next spelling review after each first-try success; a miss starts over.
INTERVALS = (1, 3, 7, 14, 30)

LETTERS = string.ascii_lowercase


def normalize(answer: str) -> str:
    """Forgive what is not spelling: case and surrounding spaces. Never a misspelling."""
    return unicodedata.normalize("NFKC", answer).strip().lower()


def is_correct(answer: str, target: str) -> bool:
    return normalize(answer) == normalize(target) != ""


def tiles(target: str, rng: random.Random) -> list[str]:
    """The letter bank for `target`, in display order."""
    word = [letter for letter in normalize(target) if letter in LETTERS]
    absent = [letter for letter in LETTERS if letter not in word]
    count = max(MIN_TILES, len(word) + MIN_DISTRACTORS)
    bank = sorted(word + rng.sample(absent, count - len(word)))
    spelled = "".join(word)
    for _ in range(100):  # a passing order is found at once in practice
        if spelled not in "".join(bank):
            return bank
        rng.shuffle(bank)
    raise ValueError(f"no tile order hides {spelled!r}")


def next_review(
    stage: int, recalled: bool, today: date, time_zone: ZoneInfo
) -> tuple[int, datetime]:
    """(next stage, when the word is due for spelling again): the start of a local day, so a
    review set for tomorrow is due from tomorrow morning, whatever time it was learned."""
    # The stage counts first-try successes in a row (capped): 1 → 1 day, 2 → 3 days … 5+ → 30.
    stage = min(stage + 1, len(INTERVALS)) if recalled else 0
    days = INTERVALS[stage - 1] if recalled else INTERVALS[0]
    return stage, datetime.combine(today + timedelta(days=days), time.min, tzinfo=time_zone)
