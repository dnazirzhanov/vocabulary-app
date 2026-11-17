"""API contracts for the Mentor chat tab."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

# Mentor chat message: trimmed, non-empty, capped to avoid runaway model calls.
MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]

# Goal text: trimmed, capped at 200 characters; empty string means "clear the goal".
GoalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class PlanItemIn(BaseModel):
    kind: Literal["vocab", "spelling", "reading"]
    title: str
    count: int | None = None
    minutes: int
    level: str | None = None


class MentorChatIn(BaseModel):
    message: MessageText
    plan: list[PlanItemIn] | None = None
    tip_id: str | None = None


class MentorChatOut(BaseModel):
    reply: str
    created_at: datetime
    chats_remaining: int


class MentorHistoryItem(BaseModel):
    role: str
    content: str
    created_at: datetime


class MentorHistoryOut(BaseModel):
    messages: list[MentorHistoryItem]


class MentorGoalOut(BaseModel):
    goal: str | None
    daily_minutes: int | None


class MentorGoalIn(BaseModel):
    goal: GoalText = ""
    daily_minutes: int | None = None


class MentorStatusOut(BaseModel):
    chats_remaining: int
    chats_limit: int
