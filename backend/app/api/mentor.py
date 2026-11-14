"""Mentor chat tab: a conversational study companion backed by DeepSeek when available."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.ratelimit import limit_mentor_chats
from app.schemas.mentor import MentorChatIn, MentorChatOut
from app.services import mentor
from app.services.card_reports import listed

router = APIRouter(tags=["mentor"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _require_mentor(user: CurrentUser, settings: DepSettings) -> None:
    if not listed(user, settings.mentor_testers):
        raise ApiError(403, "not_a_mentor_tester", "Mentor chat is not available for this account")


@router.post("/mentor/chat", dependencies=[Depends(limit_mentor_chats), Depends(_require_mentor)])
def mentor_chat(
    body: MentorChatIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    settings: DepSettings,
) -> MentorChatOut:
    reply = mentor.chat(db, user, body.message, settings, now, time_zone)
    return MentorChatOut(reply=reply, created_at=now)
