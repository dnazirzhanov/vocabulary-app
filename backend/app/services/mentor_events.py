"""What measurement needs that the learner's timeline doesn't hold (ADR 0078): each chat answer's
timing and token use, and each «Начать» tapped."""

from datetime import datetime
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models import MentorEvent, User

EventName = Literal["chat_message", "start_tapped"]


def record(db: Session, user: User, name: EventName, props: dict[str, Any], at: datetime) -> None:
    """Kept at once: measurement must not depend on what else the request does."""
    db.add(MentorEvent(user_id=user.id, at=at, name=name, props=props))
    db.commit()
