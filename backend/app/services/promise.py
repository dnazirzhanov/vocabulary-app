"""The promise (ADR 0039): the weekdays a learner promised to study, and the records built on it.

A learner promises chosen weekdays («Пн Ср Пт», or every day). Each promised day is a clear yes or
no: it is **done** when a session was finished that day (`study_days.StudyDay.studied`), and
**missed** when the day is over and none was. Days off and paused days are neither. A change
applies from tomorrow, so today's record can't be edited after the fact; history is kept, so a
change never rewrites a past month. Nothing here ranks or scores anyone.

Weekdays are numbers 0 (Monday) to 6 (Sunday); a set of them is a bitmask, Monday = 1.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import LearningSession, PromiseChange, PromisePause, User
from app.schemas.me import DayState, PauseOut, PendingPromiseOut, PromiseOut, TodayState
from app.services.study_days import StudyDay, week_of

# The row every history starts with: far enough back to cover any day we ever look at.
BASELINE = date(2020, 1, 1)
MAX_PAUSE_DAYS = 31

# The old «days a week» number spread over the week, so «3» is Пн Ср Пт, not Пн Вт Ср.
_PRESETS: dict[int, tuple[int, ...]] = {
    1: (0,),
    2: (0, 3),
    3: (0, 2, 4),
    4: (0, 1, 3, 4),
    5: (0, 1, 2, 3, 4),
    6: (0, 1, 2, 3, 4, 5),
    7: (0, 1, 2, 3, 4, 5, 6),
}


def mask_of(weekdays: Iterable[int]) -> int:
    mask = 0
    for weekday in weekdays:
        mask |= 1 << weekday
    return mask


def weekdays_of(mask: int) -> list[int]:
    return [weekday for weekday in range(7) if mask >> weekday & 1]


def preset(days_a_week: int) -> int:
    """The bitmask for the old «N days a week» promise."""
    return mask_of(_PRESETS[min(7, max(1, days_a_week))])


@dataclass(frozen=True)
class Promise:
    """One learner's promise through time: the weekdays in force from each date on, and a pause.
    With no recorded change the promise is the preset of `default_days`."""

    default_days: int
    changes: Sequence[tuple[date, int]] = ()  # (effective_from, mask), oldest first
    pause: tuple[date, date] | None = None

    def mask_on(self, day: date) -> int:
        mask = preset(self.default_days)
        for effective_from, changed in self.changes:
            if effective_from > day:
                break
            mask = changed
        return mask

    def promised_on(self, day: date) -> bool:
        if self.pause and self.pause[0] <= day <= self.pause[1]:
            return False
        return bool(self.mask_on(day) >> day.weekday() & 1)


def load_promises(db: Session, users: Sequence[User]) -> dict[UUID, Promise]:
    ids = [user.id for user in users]
    changes: dict[UUID, list[tuple[date, int]]] = {user_id: [] for user_id in ids}
    for user_id, effective_from, weekdays in db.execute(
        select(PromiseChange.user_id, PromiseChange.effective_from, PromiseChange.weekdays)
        .where(PromiseChange.user_id.in_(ids))
        .order_by(PromiseChange.effective_from)
    ):
        changes[user_id].append((effective_from, weekdays))
    pauses = {
        user_id: (from_date, until_date)
        for user_id, from_date, until_date in db.execute(
            select(PromisePause.user_id, PromisePause.from_date, PromisePause.until_date).where(
                PromisePause.user_id.in_(ids)
            )
        )
    }
    return {
        user.id: Promise(user.study_days_per_week, changes[user.id], pauses.get(user.id))
        for user in users
    }


def promise_of(db: Session, user: User) -> Promise:
    return load_promises(db, [user])[user.id]


# --- changing it ----------------------------------------------------------------------------


def set_weekdays(db: Session, user: User, weekdays: Sequence[int], today: date) -> None:
    """Promise these weekdays from tomorrow. A learner who has finished nothing yet (the first-run
    screens) has no past to protect: it applies at once."""
    mask = mask_of(weekdays)
    started = db.scalar(
        select(func.count())
        .select_from(LearningSession)
        .where(LearningSession.user_id == user.id, LearningSession.completed_at.is_not(None))
    )
    if not started:
        db.execute(delete(PromiseChange).where(PromiseChange.user_id == user.id))
        db.add(PromiseChange(user_id=user.id, effective_from=BASELINE, weekdays=mask))
    else:
        recorded = db.scalar(
            select(func.count()).select_from(PromiseChange).where(PromiseChange.user_id == user.id)
        )
        if not recorded:
            # Keep what was in force, so the past still reads as it was.
            db.add(
                PromiseChange(
                    user_id=user.id,
                    effective_from=BASELINE,
                    weekdays=preset(user.study_days_per_week),
                )
            )
            db.flush()
        db.execute(
            insert(PromiseChange)
            .values(user_id=user.id, effective_from=today + timedelta(days=1), weekdays=mask)
            .on_conflict_do_update(
                index_elements=[PromiseChange.user_id, PromiseChange.effective_from],
                set_={"weekdays": mask},
            )
        )
    user.study_days_per_week = len(weekdays_of(mask))
    db.commit()


def set_pause(db: Session, user: User, until: date, today: date) -> None:
    """Pause the promise from tomorrow until `until` (at most 31 days)."""
    start = today + timedelta(days=1)
    if until < start or until > today + timedelta(days=MAX_PAUSE_DAYS):
        raise ApiError(422, "pause_range", "A pause starts tomorrow and lasts at most 31 days")
    db.execute(
        insert(PromisePause)
        .values(user_id=user.id, from_date=start, until_date=until)
        .on_conflict_do_update(
            index_elements=[PromisePause.user_id], set_={"from_date": start, "until_date": until}
        )
    )
    db.commit()


def end_pause(db: Session, user: User, today: date) -> None:
    """A pause that hasn't begun is dropped; one under way ends today."""
    row = db.get(PromisePause, user.id)
    if row is None:
        return
    if row.from_date > today:
        db.delete(row)
    else:
        row.until_date = min(row.until_date, today)
    db.commit()


def promise_out(db: Session, user: User, today: date) -> PromiseOut:
    promise = promise_of(db, user)
    pending = next(((day, mask) for day, mask in promise.changes if day > today), None)
    pause = promise.pause if promise.pause and promise.pause[1] >= today else None
    return PromiseOut(
        weekdays=weekdays_of(promise.mask_on(today)),
        pending=PendingPromiseOut(effective_from=pending[0], weekdays=weekdays_of(pending[1]))
        if pending
        else None,
        pause=PauseOut(from_date=pause[0], until_date=pause[1]) if pause else None,
    )


# --- the records ----------------------------------------------------------------------------


def _done(studied: Mapping[date, StudyDay], day: date) -> bool:
    return day in studied and studied[day].studied


def day_state(
    promise: Promise,
    studied: Mapping[date, StudyDay],
    day: date,
    today: date,
    first_counted: date | None = None,
) -> DayState:
    """One day of the report. `first_counted`: the first day that can be missed (the day after
    joining a group); earlier days are off."""
    promised = promise.promised_on(day)
    if day > today:
        return "later" if promised else "off"
    if _done(studied, day):
        return "done"
    if day == today:
        return "today" if promised else "off"
    counted = first_counted is None or day >= first_counted
    return "missed" if promised and counted else "off"


def week_states(
    promise: Promise,
    studied: Mapping[date, StudyDay],
    today: date,
    first_counted: date | None = None,
) -> list[DayState]:
    return [day_state(promise, studied, day, today, first_counted) for day in week_of(today)]


def month_misses(
    promise: Promise,
    studied: Mapping[date, StudyDay],
    today: date,
    first_counted: date | None = None,
) -> int:
    """Promised days missed this calendar month, up to yesterday. It restarts on the 1st because
    it is counted from there."""
    start = today.replace(day=1)
    if first_counted is not None and first_counted > start:
        start = first_counted
    days = (today - start).days
    return sum(
        1
        for offset in range(max(0, days))
        if promise.promised_on(start + timedelta(days=offset))
        and not _done(studied, start + timedelta(days=offset))
    )


def today_state(promise: Promise, studied: Mapping[date, StudyDay], today: date) -> TodayState:
    if _done(studied, today):
        return "done"
    return "pending" if promise.promised_on(today) else "off"


def promised_week(promise: Promise, today: date) -> list[bool]:
    return [promise.promised_on(day) for day in week_of(today)]


def week_kept(
    promise: Promise, studied: Mapping[date, StudyDay], week: Sequence[date]
) -> bool | None:
    """Every promised day of the week done; None when nothing was promised (a paused week)."""
    promised = [day for day in week if promise.promised_on(day)]
    if not promised:
        return None
    return all(_done(studied, day) for day in promised)


def week_streak(promise: Promise, studied: Mapping[date, StudyDay], today: date) -> int:
    """Weeks in a row with every promised day done. This week counts once it is complete; last
    week otherwise, so a week under way never shows the streak as broken. A paused week neither
    counts nor breaks it."""
    monday = week_of(today)[0]
    count = 1 if week_kept(promise, studied, week_of(monday)) else 0
    week_start = monday - timedelta(days=7)
    for _ in range(53):
        kept = week_kept(promise, studied, week_of(week_start))
        if kept is False:
            break
        if kept:
            count += 1
        week_start -= timedelta(days=7)
    return count
