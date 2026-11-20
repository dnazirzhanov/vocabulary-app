"""Whether the mentor works (ADR 0078), week by week, from what is already recorded: the
learner's timeline, the mentor's events, the promise and the practice itself.

- kept: promised days with any practice, of the promised days so far (the promise's own rule);
- minutes: practice minutes per mentor user;
- start → finish: «Начать» taps followed by finished practice within 90 minutes;
- answers: how many, how fast (median to the first piece and to the end), and how much of the
  prompt the model's cache served;
- rescues by choice, facts saved from the chat;
- retention: of the learners who first used the mentor that week, how many practised again
  7–13 and 30–36 days later (once those days have passed).

Weeks run Monday to Sunday in UTC; each learner's days are their own.
"""

from collections import Counter
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from statistics import median
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import exists, func, select, union_all
from sqlalchemy.orm import Session

from app.models import (
    LearnerFact,
    LearningSession,
    MentorEvent,
    MentorTimelineEvent,
    ReadingAnswer,
    SpeakingSession,
    User,
    WritingSubmission,
)
from app.services import promise as promises
from app.services.coach.service import activity_in
from app.services.study_days import days_by_user

FINISH_WITHIN = timedelta(minutes=90)


@dataclass
class Retention:
    eligible: int = 0
    retained: int = 0


@dataclass
class Week:
    week_start: date
    mentor_users: int = 0
    promised_days: int = 0
    kept_days: int = 0
    minutes_per_user: float | None = None
    starts: int = 0
    starts_finished: int = 0
    answers: int = 0
    first_ms_median: int | None = None
    total_ms_median: int | None = None
    cache_share: float | None = None
    rescues: dict[str, int] = field(default_factory=dict)
    facts_saved: int = 0
    new_users: int = 0
    d7: Retention = field(default_factory=Retention)
    d30: Retention = field(default_factory=Retention)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _practised(db: Session, user_id: UUID, start: datetime, end: datetime) -> bool:
    """Any finished practice in [start, end): a lesson, a writing, a speaking, a reading answer."""
    checks = (
        exists().where(
            LearningSession.user_id == user_id,
            LearningSession.completed_at >= start,
            LearningSession.completed_at < end,
        ),
        exists().where(
            WritingSubmission.user_id == user_id,
            WritingSubmission.created_at >= start,
            WritingSubmission.created_at < end,
        ),
        exists().where(
            SpeakingSession.user_id == user_id,
            SpeakingSession.status == "done",
            SpeakingSession.completed_at >= start,
            SpeakingSession.completed_at < end,
        ),
        exists().where(
            ReadingAnswer.user_id == user_id,
            ReadingAnswer.sent_at >= start,
            ReadingAnswer.sent_at < end,
        ),
    )
    return any(db.scalar(select(check)) for check in checks)


def _first_use(db: Session) -> dict[UUID, datetime]:
    """When each learner first used the mentor: their earliest event or timeline entry."""
    both = union_all(
        select(MentorEvent.user_id, MentorEvent.at),
        select(MentorTimelineEvent.user_id, MentorTimelineEvent.at),
    ).subquery()
    return {
        user_id: first
        for user_id, first in db.execute(
            select(both.c.user_id, func.min(both.c.at)).group_by(both.c.user_id)
        )
    }


def _retention(
    db: Session, firsts: Iterable[tuple[UUID, datetime]], after: int, now: datetime
) -> Retention:
    seen = Retention()
    for user_id, first in firsts:
        start, end = first + timedelta(days=after), first + timedelta(days=after + 7)
        if end > now:
            continue  # those days haven't all passed yet
        seen.eligible += 1
        seen.retained += _practised(db, user_id, start, end)
    return seen


def _promise_week(db: Session, user: User, days: list[date], today: date) -> tuple[int, int, int]:
    """(promised days so far, kept, practice minutes) for one learner's week, on their clock."""
    zone = ZoneInfo(user.time_zone or "UTC")
    since = datetime.combine(days[0], datetime.min.time(), zone)
    promise = promises.promise_of(db, user)
    studied = days_by_user(db, [user], since, zone)[user.id]
    minutes = activity_in(db, user, since, zone).minutes
    promised = kept = 0
    for day in days:
        if day > today or not promise.promised_on(day):
            continue
        promised += 1
        kept += bool(minutes.get(day)) or bool(studied.get(day) and studied[day].studied)
    return promised, kept, sum(minutes.get(day, 0) for day in days)


def week_of(db: Session, monday: date, now: datetime, firsts: dict[UUID, datetime]) -> Week:
    start = datetime.combine(monday, datetime.min.time(), UTC)
    end = start + timedelta(days=7)
    week = Week(week_start=monday)
    events = db.scalars(
        select(MentorEvent).where(MentorEvent.at >= start, MentorEvent.at < end)
    ).all()
    timeline = db.scalars(
        select(MentorTimelineEvent).where(
            MentorTimelineEvent.at >= start, MentorTimelineEvent.at < end
        )
    ).all()
    users = {e.user_id for e in events} | {e.user_id for e in timeline}
    week.mentor_users = len(users)

    days = [monday + timedelta(days=n) for n in range(7)]
    minutes: list[int] = []
    for user in db.scalars(select(User).where(User.id.in_(users))) if users else []:
        today = now.astimezone(ZoneInfo(user.time_zone or "UTC")).date()
        promised, kept, spent = _promise_week(db, user, days, today)
        week.promised_days += promised
        week.kept_days += kept
        minutes.append(spent)
    week.minutes_per_user = round(sum(minutes) / len(minutes), 1) if minutes else None

    starts = [e for e in events if e.name == "start_tapped"]
    week.starts = len(starts)
    week.starts_finished = sum(
        _practised(db, e.user_id, e.at, e.at + FINISH_WITHIN) for e in starts
    )

    answers = [e.props for e in events if e.name == "chat_message"]
    week.answers = len(answers)
    timed = [a for a in answers if not a.get("demo")]
    if timed:
        week.first_ms_median = round(median(a.get("first_ms", 0) for a in timed))
        week.total_ms_median = round(median(a.get("total_ms", 0) for a in timed))
        prompt = sum(int(a.get("prompt_tokens", 0)) for a in timed)
        cached = sum(int(a.get("cached_tokens", 0)) for a in timed)
        week.cache_share = round(cached / prompt, 3) if prompt else None

    week.rescues = dict(
        Counter(str(e.note.get("mode")) for e in timeline if e.kind == "today_changed")
    )
    week.facts_saved = (
        db.scalar(
            select(func.count()).where(
                LearnerFact.source == "chat",
                LearnerFact.created_at >= start,
                LearnerFact.created_at < end,
            )
        )
        or 0
    )

    cohort = [(u, first) for u, first in firsts.items() if start <= first < end]
    week.new_users = len(cohort)
    week.d7 = _retention(db, cohort, 7, now)
    week.d30 = _retention(db, cohort, 30, now)
    return week


def weekly(db: Session, now: datetime, weeks: int = 4) -> list[Week]:
    """The last `weeks` weeks, oldest first, this one (so far) last."""
    this_monday = now.astimezone(UTC).date() - timedelta(days=now.astimezone(UTC).weekday())
    firsts = _first_use(db)
    return [
        week_of(db, this_monday - timedelta(weeks=back), now, firsts)
        for back in range(weeks - 1, -1, -1)
    ]


def table(rows: list[Week]) -> str:
    """The weeks as a plain text table, for the command line."""

    def share(part: int, whole: int) -> str:
        return f"{part}/{whole} ({100 * part // whole}%)" if whole else "—"

    lines = [
        "week        users  kept            min/user  start→finish    answers  first/total ms  "
        "cache  rescues                facts  new  D7        D30"
    ]
    for w in rows:
        timing = (
            f"{w.first_ms_median}/{w.total_ms_median}" if w.first_ms_median is not None else "—"
        )
        lines.append(
            f"{w.week_start}  {w.mentor_users:>5}  {share(w.kept_days, w.promised_days):<14}  "
            f"{w.minutes_per_user if w.minutes_per_user is not None else '—':>8}  "
            f"{share(w.starts_finished, w.starts):<14}  {w.answers:>7}  {timing:>14}  "
            f"{w.cache_share if w.cache_share is not None else '—':>5}  "
            f"{','.join(f'{k}:{v}' for k, v in sorted(w.rescues.items())) or '—':<21}  "
            f"{w.facts_saved:>5}  {w.new_users:>3}  {share(w.d7.retained, w.d7.eligible):<8}  "
            f"{share(w.d30.retained, w.d30.eligible)}"
        )
    return "\n".join(lines)
