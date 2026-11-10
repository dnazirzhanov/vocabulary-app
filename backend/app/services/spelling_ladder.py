"""Which words to spell, and how well each is spelled (ADR 0026).

Spelling has its own short ladder per word, apart from FSRS's memory of the meaning: a miss (or
a hinted answer) puts the word on the bottom rung, «трудное», due the next day. Spelled right
on the first try when it is due, it climbs: due again in 3 days, then 7, and on the third rung
it is «умеет писать» and leaves the rotation. A right answer before the word is due changes
nothing, so climbing always takes separate days. Days are the scheduler's: from 4 AM local time.

Spelling is one deck's (ADR 0056): every set below is drawn from the words of the deck whose page
the learner is on, never from their other decks. A word in two decks is on one ladder.

A spelling session takes one of five sets of words, at most `size` of them:
- `mix` (the main button): hard and climbing words that are due, then today's new words not yet
  spelled, the ones just learned first, then older words never spelled (ADR 0064). Only words a
  lesson has shown, or a group's test put on the ladder (ADR 0048);
- `today`: today's new words, those not spelled yet today first;
- `hard`: the words on the bottom rung;
- `random`: a draw from every word met, favouring words never spelled, rarely a known one;
- `all`: every word of the deck, met or not, for learning words by spelling them (ADR 0064): in
  the deck's order, those not spelled today first and those already known last. A word no lesson
  has shown is practice there: it doesn't go on the ladder, so it never reaches `mix`.
"""

import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import DeckWord, ReviewAttempt, SpellingProgress, User, UserWordProgress
from app.services.progress import INTRODUCTION, local_day_bounds
from app.services.scheduling import day_start, local_date, study_day

HARD = 0
KNOWN = 3
# Days until a word on each rung is due again.
WAIT_DAYS = {HARD: 1, 1: 3, 2: 7, KNOWN: 21}
Mode = Literal["mix", "today", "hard", "random", "all"]
SIZES = (5, 10, 20, 30)
DEFAULT_SIZE = 10
# «Вразброс» draws words never spelled three times as often, known ones rarely.
RANDOM_WEIGHT = {"never": 3.0, "climbing": 1.5, "known": 0.25}


@dataclass(frozen=True)
class Spelled:
    rung: int
    due_at: datetime
    last_spelled_at: datetime


def after_spelling(
    before: Spelled | None, right: bool, now: datetime, time_zone: ZoneInfo
) -> Spelled:
    """The word's place on the ladder after a first try at `now`; `right` is False for a miss
    or a hinted answer."""
    if right and before is not None and before.due_at > now:
        return Spelled(before.rung, before.due_at, now)  # not due yet: no climbing today
    rung = HARD if not right else (1 if before is None else min(before.rung + 1, KNOWN))
    due = day_start(study_day(now, time_zone) + timedelta(days=WAIT_DAYS[rung]), time_zone)
    return Spelled(rung, due, now)


@dataclass(frozen=True)
class Words:
    """What a learner has to spell from: words met (oldest first), today's new words (in the
    order learned), the ladder, when today began, and every word of the deck in its order."""

    met: Sequence[str]
    today: Sequence[str]
    ladder: Mapping[str, Spelled]
    today_start: datetime
    deck: Sequence[str] = ()


def _due(words: Words, now: datetime) -> list[str]:
    # Being on the ladder is enough: a group's test can put a word there before any lesson meets
    # it (ADR 0048).
    due = [
        word
        for word, spelled in words.ladder.items()
        if spelled.rung < KNOWN and spelled.due_at <= now
    ]
    return sorted(due, key=lambda word: (words.ladder[word].rung, words.ladder[word].due_at))


def _fresh(words: Words) -> list[str]:
    """Words never spelled: today's, the ones just learned first, then older ones, latest met
    first (ADR 0064): right after a lesson, its own words."""
    today = [word for word in reversed(words.today) if word not in words.ladder]
    learned_today = set(words.today)
    older = [
        word
        for word in reversed(words.met)
        if word not in words.ladder and word not in learned_today
    ]
    return today + older


def _spelled_today(words: Words, word: str) -> bool:
    spelled = words.ladder.get(word)
    return spelled is not None and spelled.last_spelled_at >= words.today_start


def pick(mode: Mode, size: int, words: Words, now: datetime, rng: random.Random) -> list[str]:
    if mode == "mix":
        chosen = _due(words, now) + _fresh(words)
    elif mode == "all":

        def later(word: str) -> tuple[bool, bool]:
            spelled = words.ladder.get(word)
            return (spelled is not None and spelled.rung == KNOWN, _spelled_today(words, word))

        chosen = sorted(words.deck, key=later)  # stable: in the deck's order
    elif mode == "today":
        # Stable: in the order learned.
        chosen = sorted(words.today, key=lambda word: _spelled_today(words, word))
    elif mode == "hard":
        hard = [w for w, s in words.ladder.items() if s.rung == HARD]
        chosen = sorted(hard, key=lambda word: words.ladder[word].due_at)
    else:

        def weight(word: str) -> float:
            spelled = words.ladder.get(word)
            if spelled is None:
                return RANDOM_WEIGHT["never"]
            return RANDOM_WEIGHT["known" if spelled.rung == KNOWN else "climbing"]

        # Weighted sampling without replacement (Efraimidis–Spirakis): highest u^(1/w) wins.
        chosen = sorted(words.met, key=lambda word: rng.random() ** (1 / weight(word)))
        chosen.reverse()
    return chosen[:size]


@dataclass(frozen=True)
class Overview:
    ready: int  # words the main button gives now
    due: int  # hard and climbing words due now
    today: int  # new words learned today
    today_left: int  # of those, never spelled
    hard: int
    known: int
    met: int
    words: int  # every word of the deck: the pool for «Все слова»


def overview(words: Words, now: datetime) -> Overview:
    fresh = set(_fresh(words))
    due = len(_due(words, now))
    rungs = [spelled.rung for spelled in words.ladder.values()]
    return Overview(
        ready=min(due + len(fresh), DEFAULT_SIZE),
        due=due,
        today=len(words.today),
        today_left=sum(1 for word in words.today if word in fresh),
        hard=rungs.count(HARD),
        known=rungs.count(KNOWN),
        met=len(words.met),
        words=len(words.deck),
    )


# --- database --------------------------------------------------------------------------------


def load(db: Session, user: User, deck_id: str, now: datetime, time_zone: ZoneInfo) -> Words:
    """What the learner has to spell from in one deck (ADR 0056)."""
    start, end = local_day_bounds(local_date(now, time_zone), time_zone)
    in_deck = select(DeckWord.word_id).where(DeckWord.deck_id == deck_id)
    met = db.scalars(
        select(UserWordProgress.word_id)
        .where(UserWordProgress.user_id == user.id, UserWordProgress.word_id.in_(in_deck))
        .order_by(UserWordProgress.introduced_at, UserWordProgress.word_id)
    ).all()
    # Answers are stored in the order given, so the first answer's id is the learning order.
    first = func.min(ReviewAttempt.id)
    today = db.scalars(
        select(ReviewAttempt.word_id)
        .where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.word_id.in_(in_deck),
            INTRODUCTION,
            ReviewAttempt.answered_at >= start,
            ReviewAttempt.answered_at < end,
        )
        .group_by(ReviewAttempt.word_id)
        .order_by(first)
    ).all()
    ladder = {
        row.word_id: Spelled(row.rung, row.due_at, row.last_spelled_at)
        for row in db.scalars(
            select(SpellingProgress).where(
                SpellingProgress.user_id == user.id, SpellingProgress.word_id.in_(in_deck)
            )
        )
    }
    deck = db.scalars(
        select(DeckWord.word_id).where(DeckWord.deck_id == deck_id).order_by(DeckWord.position)
    ).all()
    return Words(met=met, today=today, ladder=ladder, today_start=start, deck=deck)


def met_since(db: Session, user: User, deck_id: str | None, moment: datetime) -> bool:
    """New words met in the deck after `moment`. A spelling left before them is no longer offered
    to resume: the main button starts afresh with them first (ADR 0064); its answers stay."""
    if deck_id is None:
        return False
    met = db.scalar(
        select(func.count())
        .select_from(UserWordProgress)
        .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
        .where(
            DeckWord.deck_id == deck_id,
            UserWordProgress.user_id == user.id,
            UserWordProgress.introduced_at > moment,
        )
    )
    return bool(met)


def record(
    db: Session, user: User, word_id: str, right: bool, now: datetime, time_zone: ZoneInfo
) -> None:
    """Move a word on the ladder after its first try in a spelling session."""
    row = db.get(SpellingProgress, (user.id, word_id))
    before = Spelled(row.rung, row.due_at, row.last_spelled_at) if row else None
    # A try sent late from another device, earlier than one already recorded, moves the word as
    # of that later try (ADR 0062).
    moment = max(now, before.last_spelled_at) if before else now
    after = after_spelling(before, right, moment, time_zone)
    if row is None:
        row = SpellingProgress(user_id=user.id, word_id=word_id, misses=0)
        db.add(row)
    row.rung, row.due_at, row.last_spelled_at = after.rung, after.due_at, after.last_spelled_at
    row.misses += int(not right)
