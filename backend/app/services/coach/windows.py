"""Finding the best time to study: free on the chosen days, close to when the learner already
studies, in the part of the day they prefer, ideally right after a routine block («после школы»).
A few distinct options are offered; the learner picks one."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

Preference = Literal["morning", "day", "evening"]
Reason = Literal["free", "habit", "preferred", "after_block"]

EARLIEST = 6 * 60
LATEST_END = 22 * 60 + 30
STEP = 15
# Minutes kept free around a block, to get there and get going.
AIR = 10
HABIT_NEAR = 45
# Options are at least this far apart, so they are real choices.
APART = 120
_BANDS: dict[Preference, tuple[int, int]] = {
    "morning": (6 * 60, 12 * 60),
    "day": (12 * 60, 17 * 60),
    "evening": (17 * 60, 22 * 60),
}


@dataclass(frozen=True)
class Block:
    """A recurring schedule event: weekdays as a mask (Monday = 1), minutes from midnight."""

    weekdays: int
    start: int
    end: int


@dataclass(frozen=True)
class StudyTime:
    weekdays: int
    start: int
    minutes: int
    score: float
    reasons: tuple[Reason, ...] = field(default=())


def _days(mask: int) -> list[int]:
    return [d for d in range(7) if mask >> d & 1]


def free_on(blocks: Sequence[Block], day: int, start: int, end: int) -> bool:
    return not any(
        b.weekdays >> day & 1 and b.start < end + AIR and start - AIR < b.end for b in blocks
    )


def propose(
    blocks: Sequence[Block],
    weekdays: int,
    minutes: int,
    habit: Sequence[int] = (),
    preference: Preference | None = None,
    count: int = 3,
) -> list[StudyTime]:
    """Up to `count` study times, best first, each free on every chosen day. `habit`: start
    minutes of the learner's recent sessions."""
    days = _days(weekdays) or list(range(7))
    candidates: list[StudyTime] = []
    for start in range(EARLIEST, LATEST_END - minutes + 1, STEP):
        end = start + minutes
        if not all(free_on(blocks, day, start, end) for day in days):
            continue
        reasons: list[Reason] = ["free"]
        score = 0.0
        near = sum(1 for h in habit if abs(h - start) <= HABIT_NEAR)
        if near:
            reasons.append("habit")
            score += 3 * min(near, 5) / 5 + 1
        if preference and _BANDS[preference][0] <= start < _BANDS[preference][1]:
            reasons.append("preferred")
            score += 2
        # Right after a block on most chosen days: a natural cue.
        after = sum(
            1
            for day in days
            if any(b.weekdays >> day & 1 and 0 <= start - b.end <= 45 for b in blocks)
        )
        if after * 2 >= len(days):
            reasons.append("after_block")
            score += 1
        # Late evenings and very early mornings are harder to keep.
        if start >= 21 * 60 + 30 or start < 6 * 60 + 30:
            score -= 1
        # A gentle lean to the usual study hours, so ties go to early evening.
        score -= abs(start - 18 * 60) / 1440
        candidates.append(StudyTime(weekdays, start, minutes, round(score, 3), tuple(reasons)))
    chosen: list[StudyTime] = []
    for option in sorted(candidates, key=lambda c: -c.score):
        if all(abs(option.start - other.start) >= APART for other in chosen):
            chosen.append(option)
        if len(chosen) == count:
            break
    return chosen
