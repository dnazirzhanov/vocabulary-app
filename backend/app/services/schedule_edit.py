"""The mentor changes the calendar itself (ADR 0083): what the learner says about their week or a
day is saved at once, and the chat card can undo it. Everything here is checked as the schedule
API checks it, and only ever touches the learner's own blocks.

Rules:
- A block that runs past midnight (sleep 23:00–07:00) is saved as two: until midnight on its
  days, and from midnight on the days after.
- A new block replaces an existing repeating block with the same title on the same days when
  their times overlap («школа теперь с 9 до 14», «в пятницу школа до 12»), so saying the week
  again never doubles it. Other days of that block are kept.
- Removing a block by title takes it off the given days (all, if none are given).
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ScheduleEvent, ScheduleSkip, User

EVENT_KINDS = ("school", "work", "sport", "chore", "personal", "rest", "play", "sleep", "other")
ALL_DAYS = 0b1111111


@dataclass(frozen=True)
class NewBlock:
    title: str
    kind: str
    weekdays: int
    start: int
    end: int
    on_date: date | None = None


@dataclass
class Edit:
    """What a change did, and what undoing it needs."""

    added: list[dict[str, Any]] = field(default_factory=list)
    removed: list[dict[str, Any]] = field(default_factory=list)
    # Undo: delete these, put these back as they were, and take these skips off again.
    created: list[str] = field(default_factory=list)
    before: list[dict[str, Any]] = field(default_factory=list)
    skips: list[dict[str, str]] = field(default_factory=list)

    def undo(self) -> dict[str, Any]:
        return {"created": self.created, "before": self.before, "skips": self.skips}


def mask(days: list[int]) -> int:
    return sum(1 << d for d in set(days))


def _days(mask: int) -> list[int]:
    return [d for d in range(7) if mask >> d & 1]


def _next_days(mask: int) -> int:
    """Each weekday moved to the day after (Sunday → Monday)."""
    return ((mask << 1) | (mask >> 6)) & ALL_DAYS


def split_overnight(block: NewBlock) -> list[NewBlock]:
    """23:00–07:00 → 23:00–24:00 on its days and 00:00–07:00 on the next ones."""
    if block.end > block.start:
        return [block]
    if block.on_date is not None:
        # A one-off past midnight keeps its evening part; the morning is another day's business.
        return [NewBlock(block.title, block.kind, block.weekdays, block.start, 1440, block.on_date)]
    parts = (
        []
        if block.start == 1440
        else [NewBlock(block.title, block.kind, block.weekdays, block.start, 1440)]
    )
    if block.end > 0:
        parts.append(NewBlock(block.title, block.kind, _next_days(block.weekdays), 0, block.end))
    return parts


def _snapshot(event: ScheduleEvent) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "title": event.title,
        "kind": event.kind,
        "weekdays": event.weekdays,
        "start_minute": event.start_minute,
        "end_minute": event.end_minute,
        "on_date": event.on_date.isoformat() if event.on_date else None,
    }


def _shown(
    title: str, kind: str, mask: int, start: int, end: int, on: date | None = None
) -> dict[str, Any]:
    return {
        "title": title,
        "kind": kind,
        "weekdays": _days(mask),
        "start_minute": start,
        "end_minute": end,
        "on_date": on.isoformat() if on else None,
    }


def _same(a: str, b: str) -> bool:
    return " ".join(a.split()).casefold() == " ".join(b.split()).casefold()


def _repeating(db: Session, user: User) -> list[ScheduleEvent]:
    return list(
        db.scalars(
            select(ScheduleEvent)
            .where(ScheduleEvent.user_id == user.id, ScheduleEvent.on_date.is_(None))
            .order_by(ScheduleEvent.start_minute)
        )
    )


def _take_days(db: Session, edit: Edit, event: ScheduleEvent, mask: int, now: datetime) -> bool:
    """Take some weekdays off a repeating block; with none left, the block goes (True)."""
    taken = event.weekdays & mask
    if not taken:
        return False
    edit.before.append(_snapshot(event))
    edit.removed.append(
        _shown(event.title, event.kind, taken, event.start_minute, event.end_minute)
    )
    left = event.weekdays & ~mask
    if left:
        event.weekdays = left
        event.updated_at = now
        return False
    db.delete(event)
    return True


def apply(
    db: Session,
    user: User,
    now: datetime,
    add: list[NewBlock],
    remove: list[tuple[str, int]],
) -> Edit:
    """Remove, then add (replacing same-titled overlapping blocks), then commit once."""
    edit = Edit()
    # Only blocks that were there before this change: its own new blocks never replace each other
    # (sleep's two halves share a title).
    existing = _repeating(db, user)
    gone: set[uuid.UUID] = set()
    for title, days in remove:
        for event in existing:
            off = event.id not in gone and _same(event.title, title)
            if off and _take_days(db, edit, event, days or ALL_DAYS, now):
                gone.add(event.id)
    for block in [part for b in add for part in split_overnight(b)]:
        if block.on_date is None:
            for event in existing:
                overlaps = event.start_minute < block.end and block.start < event.end_minute
                same = event.id not in gone and _same(event.title, block.title) and overlaps
                if same and _take_days(db, edit, event, block.weekdays, now):
                    gone.add(event.id)
        event = ScheduleEvent(
            id=uuid.uuid4(),
            user_id=user.id,
            title=block.title,
            kind=block.kind,
            weekdays=1 << block.on_date.weekday() if block.on_date else block.weekdays,
            start_minute=block.start,
            end_minute=block.end,
            on_date=block.on_date,
            created_at=now,
            updated_at=now,
        )
        db.add(event)
        edit.created.append(str(event.id))
        edit.added.append(
            _shown(block.title, block.kind, event.weekdays, block.start, block.end, block.on_date)
        )
    db.commit()
    return edit


def skip(db: Session, user: User, day: date, event_ids: list[uuid.UUID]) -> Edit:
    """Repeating blocks off on one date («завтра нет школы»)."""
    edit = Edit()
    for event_id in event_ids:
        event = db.get(ScheduleEvent, event_id)
        if event is None or event.user_id != user.id or event.on_date is not None:
            continue
        if db.get(ScheduleSkip, (event.id, day)) is None:
            db.add(ScheduleSkip(event_id=event.id, date=day))
            edit.skips.append({"event_id": str(event.id), "date": day.isoformat()})
        edit.removed.append(
            _shown(
                event.title,
                event.kind,
                1 << day.weekday(),
                event.start_minute,
                event.end_minute,
                day,
            )
        )
    db.commit()
    return edit


def undo(db: Session, user: User, now: datetime, data: dict[str, Any]) -> None:
    """Put the calendar back as it was before one change. Only the learner's own blocks."""
    for raw in data.get("created") or []:
        event = db.get(ScheduleEvent, uuid.UUID(str(raw)))
        if event is not None and event.user_id == user.id:
            db.delete(event)
    for raw in data.get("skips") or []:
        found = db.get(
            ScheduleSkip, (uuid.UUID(str(raw["event_id"])), date.fromisoformat(raw["date"]))
        )
        if found is not None:
            owner = db.get(ScheduleEvent, found.event_id)
            if owner is not None and owner.user_id == user.id:
                db.delete(found)
    # Newest snapshot first, so a block changed twice in one go ends as it first was.
    for snap in reversed(data.get("before") or []):
        event_id = uuid.UUID(str(snap["id"]))
        event = db.get(ScheduleEvent, event_id)
        if event is not None and event.user_id != user.id:
            continue
        if event is None:
            event = ScheduleEvent(id=event_id, user_id=user.id, created_at=now)
            db.add(event)
        event.title = snap["title"]
        event.kind = snap["kind"]
        event.weekdays = snap["weekdays"]
        event.start_minute = snap["start_minute"]
        event.end_minute = snap["end_minute"]
        event.on_date = date.fromisoformat(snap["on_date"]) if snap.get("on_date") else None
        event.updated_at = now
    db.commit()
