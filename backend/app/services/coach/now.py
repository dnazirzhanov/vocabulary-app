"""What to do right now: the next task if the learner is free, or when they will be, or that the
day's plan is done. The tasks are today's to-do as the app made it (on the device, from its own
decks and library), in order."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from app.services.coach.windows import Block

State = Literal["do", "busy", "done"]
DAY_END = 23 * 60


@dataclass(frozen=True)
class Now:
    state: State
    # The task to do now (state "do"), as the app sent it.
    task: Mapping[str, Any] | None = None
    # Free until this minute (do), or busy until it (busy).
    until: int | None = None
    # The block the learner is in (busy).
    busy_with: str | None = None
    # The promised study time today, if any, and whether it is now.
    study_start: int | None = None
    in_study_time: bool = False


def blocks_today(blocks: Sequence[tuple[str, Block]], weekday: int) -> list[tuple[str, Block]]:
    return sorted(
        ((title, b) for title, b in blocks if b.weekdays >> weekday & 1), key=lambda tb: tb[1].start
    )


def what_now(
    tasks: Sequence[Mapping[str, Any]],
    blocks: Sequence[tuple[str, Block]],
    weekday: int,
    minute: int,
    study_start: int | None = None,
    study_minutes: int | None = None,
) -> Now:
    """`blocks`: the learner's schedule, titled; `weekday` 0 = Monday; `minute` from midnight."""
    today = blocks_today(blocks, weekday)
    in_study = (
        study_start is not None
        and study_minutes is not None
        and study_start - 15 <= minute < study_start + study_minutes
    )
    for title, block in today:
        if block.start <= minute < block.end:
            return Now("busy", until=block.end, busy_with=title, study_start=study_start)
    if not tasks:
        return Now("done", study_start=study_start, in_study_time=in_study)
    later = [b.start for _, b in today if b.start > minute]
    until = min(later) if later else DAY_END
    return Now("do", tasks[0], until, None, study_start, in_study)
