"""A goal broken into a week: how the promised minutes split between skills, and what that is in
things to do («60 слов, 3 текста, 1 эссе, 4 ответа»)."""

from dataclasses import dataclass
from typing import Literal

from app.services.coach.goal import GoalKind

Skill = Literal["words", "reading", "writing", "speaking"]
SKILLS: tuple[Skill, ...] = ("words", "reading", "writing", "speaking")

# Each goal's share of the week by skill (sums to 1). Words include their spelling and reviews.
MIX: dict[GoalKind, dict[Skill, float]] = {
    "ielts": {"words": 0.25, "reading": 0.25, "writing": 0.25, "speaking": 0.25},
    "conversation": {"words": 0.35, "reading": 0.1, "writing": 0.1, "speaking": 0.45},
    "travel": {"words": 0.45, "reading": 0.15, "writing": 0.0, "speaking": 0.4},
    "business": {"words": 0.3, "reading": 0.15, "writing": 0.3, "speaking": 0.25},
    "academic": {"words": 0.3, "reading": 0.3, "writing": 0.3, "speaking": 0.1},
    "general": {"words": 0.45, "reading": 0.25, "writing": 0.1, "speaking": 0.2},
}

# Minutes one unit takes, about: a new word with its later reviews and spelling, a library text
# with its questions, an essay, a spoken answer with its feedback.
MINUTES_PER_UNIT: dict[Skill, float] = {"words": 1.2, "reading": 7, "writing": 15, "speaking": 5}


@dataclass(frozen=True)
class Target:
    skill: Skill
    minutes: int
    # How many of the skill's units a week: words, texts, essays, spoken answers.
    planned: int
    done: int = 0

    @property
    def share_done(self) -> float:
        return min(1.0, self.done / self.planned) if self.planned else 1.0


def weekly_targets(kind: GoalKind, weekly_minutes: int) -> list[Target]:
    """The week's targets. A skill with any share gets at least one unit once the week has room
    for half of one; a skill with none is left out."""
    targets: list[Target] = []
    for skill in SKILLS:
        share = MIX[kind][skill]
        if share <= 0:
            continue
        minutes = round(weekly_minutes * share)
        unit = MINUTES_PER_UNIT[skill]
        planned = round(minutes / unit)
        if planned == 0 and minutes >= unit / 2:
            planned = 1
        if planned > 0:
            targets.append(Target(skill, minutes, planned))
    return targets


def with_progress(targets: list[Target], done: dict[Skill, int]) -> list[Target]:
    return [Target(t.skill, t.minutes, t.planned, done.get(t.skill, 0)) for t in targets]


def most_behind(targets: list[Target], week_share: float) -> list[Skill]:
    """Skills furthest behind where the week should be by now (`week_share`: 0 on Monday morning,
    1 on Sunday night), most behind first; skills already on pace are left out."""
    gaps = [(week_share - t.share_done, t.skill) for t in targets if t.share_done < 1]
    return [skill for gap, skill in sorted(gaps, key=lambda g: -g[0]) if gap > -0.15]
