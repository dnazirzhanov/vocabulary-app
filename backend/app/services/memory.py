"""What the mentor remembers about a learner (ADR 0075), so a new chat does not start from zero:

- facts: who they are and what they want (why, likes, dislikes, constraints, energy, their own
  words), proposed by the mentor and saved on the learner's tap, or written by the learner;
- the timeline: what happened with their plan, written by the coach as it happens;
- chat summaries: what each conversation was about.

All of it goes to the model as one short block, and the learner sees and edits all of it.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import LearnerFact, MentorConversation, MentorMessage, MentorTimelineEvent, User

FactKind = Literal["why", "likes", "dislikes", "constraint", "energy", "word", "other"]
FACT_KINDS: tuple[FactKind, ...] = (
    "why",
    "likes",
    "dislikes",
    "constraint",
    "energy",
    "word",
    "other",
)
MAX_FACTS = 60
TIMELINE_IN_PROMPT = 6
SUMMARIES_IN_PROMPT = 3
# A chat is summarised once it has this many messages, and again every this many more.
SUMMARY_EVERY = 6


# --- facts ----------------------------------------------------------------------------------


def facts(db: Session, user: User) -> list[LearnerFact]:
    return list(
        db.scalars(
            select(LearnerFact)
            .where(LearnerFact.user_id == user.id, LearnerFact.superseded_at.is_(None))
            .order_by(LearnerFact.created_at)
        )
    )


def add_fact(
    db: Session, user: User, kind: FactKind, text: str, source: str, now: datetime
) -> LearnerFact:
    text = " ".join(text.split())[:200]
    if not text:
        raise ApiError(422, "empty_fact", "A fact needs words")
    if len(facts(db, user)) >= MAX_FACTS:
        raise ApiError(409, "too_many_facts", "Remove a fact before adding another")
    same = db.scalar(
        select(LearnerFact).where(
            LearnerFact.user_id == user.id,
            LearnerFact.superseded_at.is_(None),
            func.lower(LearnerFact.text) == text.lower(),
        )
    )
    if same is not None:
        return same  # tapped twice, or said twice: one fact
    fact = LearnerFact(user_id=user.id, kind=kind, text=text, source=source, created_at=now)
    db.add(fact)
    db.commit()
    return fact


def _mine(db: Session, user: User, fact_id: uuid.UUID) -> LearnerFact:
    fact = db.get(LearnerFact, fact_id)
    if fact is None or fact.user_id != user.id or fact.superseded_at is not None:
        raise ApiError(404, "fact_not_found", "No such fact")
    return fact


def change_fact(
    db: Session, user: User, fact_id: uuid.UUID, kind: FactKind, text: str, now: datetime
) -> LearnerFact:
    """A changed fact replaces the old one, which is kept as superseded."""
    old = _mine(db, user, fact_id)
    old.superseded_at = now
    db.flush()
    return add_fact(db, user, kind, text, "user", now)


def forget_fact(db: Session, user: User, fact_id: uuid.UUID) -> None:
    """Forgetting is deleting: the learner asked for it to be gone."""
    db.delete(_mine(db, user, fact_id))
    db.commit()


# --- the timeline ---------------------------------------------------------------------------


def note(db: Session, user: User, kind: str, details: dict[str, Any], at: datetime) -> None:
    """Something happened with the plan; the caller commits."""
    db.add(MentorTimelineEvent(user_id=user.id, at=at, kind=kind, note=details))


def timeline(db: Session, user: User, limit: int = 50) -> list[MentorTimelineEvent]:
    return list(
        db.scalars(
            select(MentorTimelineEvent)
            .where(MentorTimelineEvent.user_id == user.id)
            .order_by(MentorTimelineEvent.at.desc())
            .limit(limit)
        )
    )


# --- chat summaries -------------------------------------------------------------------------


def needs_summary(db: Session, conversation: MentorConversation) -> bool:
    count = (
        db.scalar(select(func.count()).where(MentorMessage.conversation_id == conversation.id)) or 0
    )
    done = conversation.summarized_messages or 0
    return count >= SUMMARY_EVERY and count - done >= SUMMARY_EVERY


def transcript(db: Session, conversation: MentorConversation, limit: int = 30) -> str:
    rows = db.scalars(
        select(MentorMessage)
        .where(MentorMessage.conversation_id == conversation.id)
        .order_by(MentorMessage.created_at.desc())
        .limit(limit)
    ).all()
    return "\n".join(f"{m.role}: {m.content[:400]}" for m in reversed(rows))


def save_summary(db: Session, conversation: MentorConversation, summary: str) -> None:
    count = db.scalar(select(func.count()).where(MentorMessage.conversation_id == conversation.id))
    conversation.summary = summary.strip()[:600]
    conversation.summarized_messages = count
    db.commit()


# --- what goes to the model -----------------------------------------------------------------


def _event_line(event: MentorTimelineEvent, zone: ZoneInfo) -> str:
    when = event.at.astimezone(zone).strftime("%a %d %b")
    details = ", ".join(f"{k}={v}" for k, v in event.note.items() if v not in (None, ""))
    return f"  - {when}: {event.kind}" + (f" ({details})" if details else "")


def block(
    db: Session, user: User, zone: ZoneInfo, current: MentorConversation | None = None
) -> str:
    """What the mentor knows about this learner, for the prompt; empty when nothing is known."""
    lines: list[str] = []
    known = facts(db, user)
    if known:
        lines.append("What the learner told you about themselves (use it; never invent more):")
        lines += [f"  - [{f.kind}] {f.text}" for f in known]
    events = timeline(db, user, TIMELINE_IN_PROMPT)
    if events:
        lines.append("What happened with their plan lately (newest first):")
        lines += [_event_line(e, zone) for e in events]
    earlier = db.scalars(
        select(MentorConversation)
        .where(
            MentorConversation.user_id == user.id,
            MentorConversation.summary.is_not(None),
            MentorConversation.id != (current.id if current else None),
        )
        .order_by(MentorConversation.updated_at.desc())
        .limit(SUMMARIES_IN_PROMPT)
    ).all()
    if earlier:
        lines.append("Earlier chats, in short:")
        lines += [f"  - «{c.title}»: {c.summary}" for c in earlier]
    return "\n".join(lines)


def search(db: Session, user: User, query: str, zone: ZoneInfo) -> dict[str, Sequence[str]]:
    """Facts, timeline events and chat summaries that mention `query`."""
    words = [w for w in query.split() if len(w) >= 3][:5] or [query]
    patterns = [f"%{w[:-1] if len(w) > 4 else w}%" for w in words]
    found_facts = db.scalars(
        select(LearnerFact).where(
            LearnerFact.user_id == user.id,
            LearnerFact.superseded_at.is_(None),
            or_(*[LearnerFact.text.ilike(p) for p in patterns]),
        )
    ).all()
    found_chats = db.scalars(
        select(MentorConversation).where(
            MentorConversation.user_id == user.id,
            or_(
                *[MentorConversation.summary.ilike(p) for p in patterns],
                *[MentorConversation.title.ilike(p) for p in patterns],
            ),
        )
    ).all()
    events = [
        _event_line(e, zone)
        for e in timeline(db, user, 100)
        if any(w.lower()[:4] in (e.kind + str(e.note)).lower() for w in words)
    ]
    return {
        "facts": [f"[{f.kind}] {f.text}" for f in found_facts],
        "chats": [f"«{c.title}»: {c.summary or ''}" for c in found_chats][:5],
        "events": events[:8],
    }
