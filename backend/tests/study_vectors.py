"""Test cases the device's study engine must match (ADR 0062), made by running the server's own
code: card schedules (FSRS and the app's day rules), the lesson queue, the day's pace, the spelling
ladder and the learner's days. Written to web/src/study/vectors.json; tests/test_study_vectors.py
fails when the file and the code disagree.

    uv run python -m tests.study_vectors   # rewrite the file after changing the rules
"""

import json
import random
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.services import learning, pace, spelling, spelling_ladder
from app.services.progress import local_day_bounds
from app.services.scheduling import (
    SCHEDULER,
    CardState,
    day_start,
    local_date,
    previews,
    review,
    study_day,
)

OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "study" / "vectors.json"
# The app's own zones, and some whose clocks change, including at awkward hours.
ZONES = (
    "UTC",
    "Asia/Bishkek",
    "Asia/Tashkent",
    "Asia/Almaty",
    "Asia/Dushanbe",
    "Europe/Moscow",
    "Europe/London",
    "America/New_York",
    "America/Santiago",
    "Australia/Lord_Howe",
)
START = datetime(2026, 1, 1, tzinfo=UTC)


def ms(moment: datetime | None) -> int | None:
    return None if moment is None else round(moment.timestamp() * 1000)


def card_json(card: CardState | None) -> list[Any] | None:
    if card is None:
        return None
    return [
        card.state,
        card.step,
        card.stability,
        card.difficulty,
        ms(card.due_at),
        ms(card.last_reviewed_at),
    ]


def schedules(rng: random.Random) -> list[list[Any]]:
    """Histories of one word: answers minutes to weeks apart, sometimes late (overdue)."""
    cases: list[list[Any]] = []
    for _ in range(260):
        zone = rng.choice(ZONES)
        tz = ZoneInfo(zone)
        now = START + timedelta(seconds=rng.randrange(0, 365 * 86400))
        card: CardState | None = None
        for _ in range(rng.randrange(1, 9)):
            rating = rng.choices((1, 2, 3, 4), weights=(2, 2, 5, 2))[0]
            after = review(card, rating, now, tz)
            shown = {r: round(d.total_seconds()) for r, d in previews(card, now, tz).items()}
            cases.append(
                [
                    card_json(card),
                    rating,
                    ms(now),
                    zone,
                    card_json(after),
                    [shown[r] for r in (1, 2, 3, 4)],
                ]
            )
            card = after
            # Next answer: on time, early, late, or the same few minutes.
            wait = rng.choice(("due", "early", "late", "soon"))
            if wait == "soon":
                now += timedelta(seconds=rng.randrange(30, 3600))
            else:
                due = max(card.due_at, now + timedelta(seconds=60))
                spread = (due - now).total_seconds()
                factor = {"due": 1.0, "early": rng.uniform(0.2, 0.9), "late": rng.uniform(1.1, 4)}[
                    wait
                ]
                now += timedelta(seconds=max(60, round(spread * factor + rng.randrange(0, 7200))))
    return cases


def days(rng: random.Random) -> list[list[Any]]:
    """Moments around midnight, 4 AM and clock changes: study day, calendar day, day starts."""
    cases: list[list[Any]] = []
    for _ in range(400):
        zone = rng.choice(ZONES)
        tz = ZoneInfo(zone)
        moment = START + timedelta(seconds=rng.randrange(0, 2 * 365 * 86400))
        day = study_day(moment, tz)
        cal = local_date(moment, tz)
        start, end = local_day_bounds(cal, tz)
        cases.append(
            [
                ms(moment),
                zone,
                day.isoformat(),
                cal.isoformat(),
                ms(day_start(day, tz)),
                ms(start),
                ms(end),
            ]
        )
    return cases


def queues(rng: random.Random) -> list[list[Any]]:
    cases: list[list[Any]] = []
    for _ in range(150):
        words = [f"w{n}" for n in range(rng.randrange(1, 12))]
        due = rng.sample(words, rng.randrange(0, len(words) + 1))
        fresh = [word for word in words if word not in due]
        plan = learning.plan_cards(due, fresh)
        answered = rng.randrange(0, len(plan))
        word = rng.choice(plan).word_id
        # Earlier showings, so the cap is reached sometimes.
        for _ in range(rng.randrange(0, 4)):
            added = learning.requeue(plan, answered, word)
            if added:
                plan = added[0]
        result = learning.requeue(plan, answered, word)
        cases.append(
            [
                [[s.id, s.word_id, s.new] for s in plan],
                answered,
                word,
                None if result is None else [[s.id, s.word_id, s.new] for s in result[0]],
            ]
        )
    return cases


def paces(rng: random.Random) -> list[list[Any]]:
    cases: list[list[Any]] = []
    for _ in range(200):
        target = rng.choice((1, 3, 5, 8, 10, 12, 20, 40, 100))
        enabled = rng.random() < 0.7
        today = date(2026, 3, 1) + timedelta(days=rng.randrange(0, 60))
        started = None if rng.random() < 0.2 else today - timedelta(days=rng.randrange(-3, 30))
        week = pace.ramp_week(target, enabled, started, today)
        new_today = rng.randrange(0, 30)
        due = rng.randrange(0, 1200)
        deadline = None if rng.random() < 0.5 else today + timedelta(days=rng.randrange(-2, 20))
        left = rng.randrange(0, 80)
        share = pace.deadline_share(left, today, deadline) if deadline else 0
        extra = rng.choice((0, 0, 5, 20))
        plan = pace.plan_day(
            target, week, new_today, due, deadline=deadline, share=share, extra=extra
        )
        cases.append(
            [
                target,
                enabled,
                None if started is None else started.isoformat(),
                today.isoformat(),
                week,
                left,
                None if deadline is None else deadline.isoformat(),
                share,
                new_today,
                due,
                extra,
                [
                    plan.effective_target,
                    plan.remaining,
                    plan.next_lesson_size,
                    plan.bonus,
                    plan.blocked_by_reviews,
                ],
            ]
        )
    return cases


def spelled_json(spelled: spelling_ladder.Spelled | None) -> list[Any] | None:
    if spelled is None:
        return None
    return [spelled.rung, ms(spelled.due_at), ms(spelled.last_spelled_at)]


def ladders(rng: random.Random) -> dict[str, list[Any]]:
    steps: list[list[Any]] = []
    for _ in range(200):
        zone = rng.choice(ZONES)
        tz = ZoneInfo(zone)
        now = START + timedelta(seconds=rng.randrange(0, 365 * 86400))
        before = None
        if rng.random() < 0.8:
            before = spelling_ladder.Spelled(
                rng.randrange(0, 4),
                now + timedelta(seconds=rng.randrange(-10 * 86400, 10 * 86400)),
                now - timedelta(seconds=rng.randrange(0, 20 * 86400)),
            )
        right = rng.random() < 0.6
        after = spelling_ladder.after_spelling(before, right, now, tz)
        steps.append([spelled_json(before), right, ms(now), zone, spelled_json(after)])
    picks: list[list[Any]] = []
    for _ in range(150):
        now = START + timedelta(days=rng.randrange(0, 300), hours=10)
        met = [f"w{n}" for n in range(rng.randrange(0, 14))]
        today = [word for word in met if rng.random() < 0.3]
        ladder = {
            word: spelling_ladder.Spelled(
                rng.randrange(0, 4),
                now + timedelta(hours=rng.randrange(-72, 72)),
                now - timedelta(hours=rng.randrange(0, 48)),
            )
            for word in met
            if rng.random() < 0.5
        }
        # The deck in its own order, with words no lesson has shown (for «Все слова»).
        deck = met + [f"u{n}" for n in range(rng.randrange(0, 5))]
        rng.shuffle(deck)
        words = spelling_ladder.Words(met, today, ladder, now - timedelta(hours=6), deck)
        mode: spelling_ladder.Mode = rng.choice(("mix", "today", "hard", "all"))
        size = rng.choice(spelling_ladder.SIZES)
        chosen = spelling_ladder.pick(mode, size, words, now, random.Random(0))
        seen = spelling_ladder.overview(words, now)
        picks.append(
            [
                met,
                today,
                deck,
                [[w, s.rung, ms(s.due_at), ms(s.last_spelled_at)] for w, s in ladder.items()],
                ms(now - timedelta(hours=6)),
                ms(now),
                mode,
                size,
                chosen,
                [
                    seen.ready,
                    seen.due,
                    seen.today,
                    seen.today_left,
                    seen.hard,
                    seen.known,
                    seen.met,
                    seen.words,
                ],
            ]
        )
    texts = ["house", "Carry out", " well-known ", "o'clock", "ICE CREAM", "x-ray", "mother-in-law"]
    words_ = [
        [t, spelling.normalize(t), spelling.letters(t), spelling.separators(t)] for t in texts
    ]
    return {"steps": steps, "picks": picks, "words": words_}


def intervals() -> list[list[float]]:
    """Stabilities whose interval lands exactly on a half day: Python rounds those to the even
    day, JavaScript's Math.round would not (the most likely slip in a port)."""
    cases: list[list[float]] = []
    for half in range(0, 60):
        stability = half + 0.5
        cases.append([stability, SCHEDULER._next_interval(stability=stability)])
    return cases


def build() -> dict[str, Any]:
    rng = random.Random(62)
    return {
        "intervals": intervals(),
        "schedules": schedules(rng),
        "days": days(rng),
        "queues": queues(rng),
        "paces": paces(rng),
        "ladder": ladders(rng),
    }


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    OUT.write_text(render())
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
