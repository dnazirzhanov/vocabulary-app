"""Mentor chat tab: a conversational study companion backed by DeepSeek when available."""

import json
from collections.abc import Generator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.ratelimit import limit_mentor_chats, mentor_chats_used
from app.schemas.mentor import (
    MentorChatIn,
    MentorChatOut,
    MentorGoalIn,
    MentorGoalOut,
    MentorHistoryItem,
    MentorHistoryOut,
    MentorStatusOut,
)
from app.services import mentor
from app.services.card_reports import listed

router = APIRouter(tags=["mentor"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _require_mentor(user: CurrentUser, settings: DepSettings) -> None:
    if not listed(user, settings.mentor_testers):
        raise ApiError(403, "not_a_mentor_tester", "Mentor chat is not available for this account")


@router.get("/mentor/goal", dependencies=[Depends(_require_mentor)])
def mentor_get_goal(user: CurrentUser) -> MentorGoalOut:
    return MentorGoalOut(goal=user.mentor_goal)


@router.put("/mentor/goal", dependencies=[Depends(_require_mentor)])
def mentor_set_goal(body: MentorGoalIn, user: CurrentUser, db: DbSession) -> MentorGoalOut:
    user.mentor_goal = body.goal or None
    db.commit()
    return MentorGoalOut(goal=user.mentor_goal)


@router.get("/mentor/status", dependencies=[Depends(_require_mentor)])
def mentor_status(user: CurrentUser, settings: DepSettings) -> MentorStatusOut:
    used = mentor_chats_used(user.id)
    remaining = max(0, settings.mentor_chats_per_day - used)
    return MentorStatusOut(chats_remaining=remaining, chats_limit=settings.mentor_chats_per_day)


@router.get("/mentor/history", dependencies=[Depends(_require_mentor)])
def mentor_history(user: CurrentUser, db: DbSession) -> MentorHistoryOut:
    messages = mentor.history(db, user)
    return MentorHistoryOut(
        messages=[
            MentorHistoryItem(role=m.role, content=m.content, created_at=m.created_at)
            for m in messages
        ]
    )


@router.delete("/mentor/history", status_code=204, dependencies=[Depends(_require_mentor)])
def mentor_clear_history(user: CurrentUser, db: DbSession) -> None:
    mentor.clear_history(db, user)


@router.post("/mentor/chat", dependencies=[Depends(limit_mentor_chats), Depends(_require_mentor)])
def mentor_chat(
    body: MentorChatIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    settings: DepSettings,
) -> MentorChatOut:
    plan = [item.model_dump() for item in body.plan] if body.plan else None
    reply = mentor.chat(
        db, user, body.message, settings, now, time_zone, plan=plan, tip_id=body.tip_id
    )
    used = mentor_chats_used(user.id)
    remaining = max(0, settings.mentor_chats_per_day - used)
    return MentorChatOut(reply=reply, created_at=now, chats_remaining=remaining)


@router.post(
    "/mentor/chat/stream",
    dependencies=[Depends(limit_mentor_chats), Depends(_require_mentor)],
    response_class=StreamingResponse,
)
def mentor_chat_stream(
    body: MentorChatIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    settings: DepSettings,
) -> StreamingResponse:
    def _sse(chunks: Generator[str]) -> Generator[str]:
        for delta in chunks:
            yield f"data: {json.dumps({'delta': delta})}\n\n"
        used = mentor_chats_used(user.id)
        remaining = max(0, settings.mentor_chats_per_day - used)
        done_event = {"done": True, "created_at": now.isoformat(), "chats_remaining": remaining}
        yield f"data: {json.dumps(done_event)}\n\n"

    plan = [item.model_dump() for item in body.plan] if body.plan else None
    chunks = mentor.stream_chat(
        db, user, body.message, settings, now, time_zone, plan=plan, tip_id=body.tip_id
    )
    return StreamingResponse(_sse(chunks), media_type="text/event-stream")
