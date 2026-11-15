"""API contracts for the Mentor chat tab."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

# Mentor chat message: trimmed, non-empty, capped to avoid runaway model calls.
MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class MentorChatIn(BaseModel):
    message: MessageText


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
