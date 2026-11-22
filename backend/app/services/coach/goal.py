"""A learner's goal, and an honest check of it against the time they can give.

The hours are Cambridge English's approximate guided learning hours to reach each CEFR level,
counted from zero. They are an estimate and are shown as one («примерно»); the weekly review
corrects course as real progress comes in.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

GoalKind = Literal["ielts", "conversation", "travel", "business", "academic", "general"]
GOAL_KINDS: tuple[GoalKind, ...] = (
    "ielts",
    "conversation",
    "travel",
    "business",
    "academic",
    "general",
)
CEFR = ("A1", "A2", "B1", "B2", "C1", "C2")
# Cumulative guided learning hours to reach each level (Cambridge English, approximate).
GUIDED_HOURS = {"A1": 90, "A2": 190, "B1": 375, "B2": 550, "C1": 750, "C2": 1100}
# IELTS bands as CEFR levels (IELTS's own comparison), highest first.
_IELTS_LEVELS = ((8.5, "C2"), (7.0, "C1"), (5.5, "B2"), (4.0, "B1"), (0.0, "A2"))

# Within this share of the time needed, it is tight but possible.
TIGHT = 0.7

Status = Literal["on_track", "tight", "not_possible", "open", "reached"]


@dataclass(frozen=True)
class Goal:
    kind: GoalKind
    # A CEFR level («B2») or an IELTS band («6.5»); None for an open-ended goal.
    target: str | None = None
    deadline: date | None = None
    why: str | None = None
    # Where the learner starts (their course level, or what they said).
    start_level: str | None = None


def level_of(kind: GoalKind, target: str | None) -> str | None:
    """The CEFR level a target means, or None if it names none."""
    if not target:
        return None
    if target.upper() in CEFR:
        return target.upper()
    if kind == "ielts":
        try:
            band = float(target.replace(",", "."))
        except ValueError:
            return None
        return next(level for floor, level in _IELTS_LEVELS if band >= floor)
    return None


@dataclass(frozen=True)
class Feasibility:
    status: Status
    # Learning hours from the start level to the target (an estimate).
    hours_needed: int | None
    weeks_left: float | None
    # Minutes a week the goal asks for, and what the learner has promised.
    weekly_minutes_needed: int | None
    weekly_minutes: int
    # On each promised day, how long it would take to make the deadline.
    minutes_a_day_needed: int | None
    # At the promised pace, when the target would be reached.
    reached_by: date | None


def feasibility(goal: Goal, minutes_a_day: int, days_a_week: int, today: date) -> Feasibility:
    """Whether the promised time reaches the target by the deadline, and what would."""
    weekly = max(0, minutes_a_day) * max(1, days_a_week)
    target = level_of(goal.kind, goal.target)
    start = goal.start_level.upper() if goal.start_level else None
    if target is None or start not in GUIDED_HOURS:
        return Feasibility("open", None, None, None, weekly, None, None)
    hours = GUIDED_HOURS[target] - GUIDED_HOURS[start]
    if hours <= 0:
        return Feasibility("reached", 0, None, None, weekly, None, None)
    reached_by = today + timedelta(weeks=hours * 60 / weekly) if weekly > 0 else None
    if goal.deadline is None or goal.deadline <= today:
        return Feasibility("open", hours, None, None, weekly, None, reached_by)
    weeks = (goal.deadline - today).days / 7
    needed = round(hours * 60 / weeks)
    per_day = -(-needed // max(1, days_a_week))  # rounded up
    share = weekly / needed if needed else 1.0
    status: Status = "on_track" if share >= 1 else "tight" if share >= TIGHT else "not_possible"
    return Feasibility(status, hours, round(weeks, 1), needed, weekly, per_day, reached_by)
