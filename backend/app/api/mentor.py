"""Mentor chat tab: a conversational study companion backed by DeepSeek when available."""

import json
import uuid
from collections.abc import Generator
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.ratelimit import limit_mentor_chats, mentor_chats_used
from app.schemas.coach import (
    AdjustmentOut,
    CoachOut,
    CommitmentIn,
    CommitmentOut,
    DecisionIn,
    FactIn,
    FactOut,
    FeasibilityOut,
    GoalIn,
    GoalOut,
    MemoryOut,
    StudyTimeOut,
    TargetOut,
    TimelineOut,
    TodayIn,
    TodayOut,
)
from app.schemas.mentor import (
    ConversationIn,
    ConversationOut,
    MentorChatIn,
    MentorChatOut,
    MentorGoalIn,
    MentorGoalOut,
    MentorHistoryItem,
    MentorHistoryOut,
    MentorStatusOut,
    MessageOut,
)
from app.services import memory, mentor
from app.services.card_reports import listed
from app.services.coach import service as coach
from app.services.promise import mask_of, weekdays_of

router = APIRouter(tags=["mentor"])

DepSettings = Annotated[Settings, Depends(get_settings)]


def _require_mentor(user: CurrentUser, settings: DepSettings) -> None:
    if not listed(user, settings.mentor_testers):
        raise ApiError(403, "not_a_mentor_tester", "Mentor chat is not available for this account")


@router.get("/mentor/goal", dependencies=[Depends(_require_mentor)])
def mentor_get_goal(user: CurrentUser) -> MentorGoalOut:
    return MentorGoalOut(goal=user.mentor_goal, daily_minutes=user.mentor_daily_minutes)


@router.put("/mentor/goal", dependencies=[Depends(_require_mentor)])
def mentor_set_goal(body: MentorGoalIn, user: CurrentUser, db: DbSession) -> MentorGoalOut:
    user.mentor_goal = body.goal or None
    user.mentor_daily_minutes = body.daily_minutes
    db.commit()
    return MentorGoalOut(goal=user.mentor_goal, daily_minutes=user.mentor_daily_minutes)


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
    plan = [item.model_dump() for item in body.plan] if body.plan is not None else None
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
    def _sse(events: Generator[dict[str, Any]]) -> Generator[str]:
        for event in events:
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        used = mentor_chats_used(user.id)
        remaining = max(0, settings.mentor_chats_per_day - used)
        done_event = {"done": True, "created_at": now.isoformat(), "chats_remaining": remaining}
        yield f"data: {json.dumps(done_event)}\n\n"
        # The answer is out; a long chat gets its summary now (ADR 0075).
        mentor.summarize_if_due(db, user, conversation, settings)

    plan = [item.model_dump() for item in body.plan] if body.plan is not None else None
    # Before the stream starts: someone else's chat is a plain 404.
    conversation = mentor.resolve_conversation(
        db, user, body.conversation_id, body.new_conversation, body.message, now
    )
    chunks = mentor.stream_chat(
        db,
        user,
        body.message,
        settings,
        now,
        time_zone,
        plan=plan,
        tip_id=body.tip_id,
        conversation=conversation,
    )
    return StreamingResponse(_sse(chunks), media_type="text/event-stream")


# --- the coach (ADR 0071) -------------------------------------------------------------------


def _coach_out(state: coach.CoachState) -> CoachOut:
    goal = state.goal
    seen = state.feasibility
    adjustment = state.adjustment
    return CoachOut(
        goal=GoalOut(
            kind=goal.kind,
            target=goal.target,
            deadline=goal.deadline,
            why=goal.why,
            start_level=goal.start_level,
        )
        if goal
        else None,
        feasibility=FeasibilityOut(**vars(seen)) if seen else None,
        week_start=state.week_start,
        targets=[
            TargetOut(skill=t.skill, minutes=t.minutes, planned=t.planned, done=t.done)
            for t in state.targets
        ],
        behind=list(state.behind),
        promised=state.promised,
        studied=state.studied,
        commitment=CommitmentOut(
            weekdays=weekdays_of(state.commitment.weekdays),
            start_minute=state.commitment.start_minute,
            minutes=state.commitment.minutes,
            pending_from=state.commitment.pending_from,
        ),
        adjustment=AdjustmentOut(
            id=adjustment.id,
            kind=adjustment.kind,
            evidence=adjustment.evidence,
            proposal=adjustment.proposal,
        )
        if adjustment
        else None,
        today=TodayOut(**vars(state.today)),
    )


@router.get("/mentor/coach", dependencies=[Depends(_require_mentor)])
def mentor_coach(user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone) -> CoachOut:
    return _coach_out(coach.coach_state(db, user, now, time_zone))


@router.put("/mentor/coach/goal", dependencies=[Depends(_require_mentor)])
def mentor_coach_goal(
    body: GoalIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> CoachOut:
    coach.set_goal(db, user, body.kind, body.target, body.deadline, body.why, body.start_level, now)
    return _coach_out(coach.coach_state(db, user, now, time_zone))


@router.get("/mentor/coach/study-times", dependencies=[Depends(_require_mentor)])
def mentor_study_times(
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    minutes: Annotated[int, Query(ge=5, le=180)],
    weekdays: Annotated[list[int], Query(min_length=1, max_length=7)],
    preference: Literal["morning", "day", "evening"] | None = None,
) -> list[StudyTimeOut]:
    if any(not 0 <= day <= 6 for day in weekdays):
        raise ApiError(422, "bad_weekdays", "Weekdays are 0 (Monday) to 6 (Sunday)")
    options = coach.study_times(db, user, mask_of(weekdays), minutes, preference, now, time_zone)
    return [
        StudyTimeOut(
            weekdays=weekdays_of(o.weekdays),
            start_minute=o.start,
            minutes=o.minutes,
            reasons=list(o.reasons),
        )
        for o in options
    ]


@router.put("/mentor/coach/commitment", dependencies=[Depends(_require_mentor)])
def mentor_commit(
    body: CommitmentIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> CoachOut:
    today = now.astimezone(time_zone).date()
    coach.commit(db, user, sorted(set(body.weekdays)), body.start_minute, body.minutes, today, now)
    return _coach_out(coach.coach_state(db, user, now, time_zone))


@router.put("/mentor/coach/today", dependencies=[Depends(_require_mentor)])
def mentor_set_today(
    body: TodayIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> CoachOut:
    """When today doesn't work (ADR 0074): the minimum, a later time, or tomorrow."""
    if body.mode == "moved" and body.start_minute is None:
        raise ApiError(422, "start_required", "A moved plan needs its new time")
    coach.set_today(db, user, body.mode, body.start_minute, now, time_zone)
    return _coach_out(coach.coach_state(db, user, now, time_zone))


@router.delete("/mentor/coach/today", dependencies=[Depends(_require_mentor)])
def mentor_undo_today(user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone) -> CoachOut:
    coach.set_today(db, user, None, None, now, time_zone)
    return _coach_out(coach.coach_state(db, user, now, time_zone))


@router.post("/mentor/coach/adjustments/{adjustment_id}", dependencies=[Depends(_require_mentor)])
def mentor_decide(
    adjustment_id: uuid.UUID,
    body: DecisionIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
) -> CoachOut:
    coach.decide(db, user, adjustment_id, body.accept, now, time_zone)
    return _coach_out(coach.coach_state(db, user, now, time_zone))


# --- chats (ADR 0072) -----------------------------------------------------------------------


@router.get("/mentor/conversations", dependencies=[Depends(_require_mentor)])
def mentor_conversations(user: CurrentUser, db: DbSession) -> list[ConversationOut]:
    return [
        ConversationOut(id=c.id, title=c.title, updated_at=c.updated_at)
        for c in mentor.conversations(db, user)
    ]


@router.get(
    "/mentor/conversations/{conversation_id}/messages", dependencies=[Depends(_require_mentor)]
)
def mentor_conversation_messages(
    conversation_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[MessageOut]:
    conversation = mentor.conversation_of(db, user, conversation_id)
    return [
        MessageOut(role=m.role, content=m.content, created_at=m.created_at, parts=m.parts or [])
        for m in mentor.messages_of(db, conversation)
    ]


@router.patch("/mentor/conversations/{conversation_id}", dependencies=[Depends(_require_mentor)])
def mentor_rename_conversation(
    conversation_id: uuid.UUID, body: ConversationIn, user: CurrentUser, db: DbSession
) -> ConversationOut:
    conversation = mentor.conversation_of(db, user, conversation_id)
    conversation.title = body.title
    db.commit()
    return ConversationOut(
        id=conversation.id, title=conversation.title, updated_at=conversation.updated_at
    )


@router.delete(
    "/mentor/conversations/{conversation_id}",
    status_code=204,
    dependencies=[Depends(_require_mentor)],
)
def mentor_delete_conversation(
    conversation_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    conversation = mentor.conversation_of(db, user, conversation_id)
    db.delete(conversation)
    db.commit()


# --- what the mentor knows (ADR 0075) -------------------------------------------------------


def _memory_out(db: Any, user: Any) -> MemoryOut:
    return MemoryOut(
        facts=[
            FactOut(id=f.id, kind=f.kind, text=f.text, source=f.source, created_at=f.created_at)
            for f in memory.facts(db, user)
        ],
        timeline=[
            TimelineOut(at=e.at, kind=e.kind, note=e.note) for e in memory.timeline(db, user)
        ],
    )


@router.get("/mentor/memory", dependencies=[Depends(_require_mentor)])
def mentor_memory(user: CurrentUser, db: DbSession) -> MemoryOut:
    """Everything the mentor remembers about the learner, for them to see and edit."""
    return _memory_out(db, user)


@router.post("/mentor/memory/facts", dependencies=[Depends(_require_mentor)])
def mentor_add_fact(body: FactIn, user: CurrentUser, db: DbSession, now: Now) -> MemoryOut:
    memory.add_fact(db, user, body.kind, body.text, body.source, now)
    return _memory_out(db, user)


@router.put("/mentor/memory/facts/{fact_id}", dependencies=[Depends(_require_mentor)])
def mentor_change_fact(
    fact_id: uuid.UUID, body: FactIn, user: CurrentUser, db: DbSession, now: Now
) -> MemoryOut:
    memory.change_fact(db, user, fact_id, body.kind, body.text, now)
    return _memory_out(db, user)


@router.delete("/mentor/memory/facts/{fact_id}", dependencies=[Depends(_require_mentor)])
def mentor_forget_fact(fact_id: uuid.UUID, user: CurrentUser, db: DbSession) -> MemoryOut:
    memory.forget_fact(db, user, fact_id)
    return _memory_out(db, user)
