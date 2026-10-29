"""Friend groups: create, join by invite code, leave, and the weekly board."""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.ratelimit import limit_joins
from app.schemas.groups import (
    BoardOut,
    CreateGroupIn,
    GroupOut,
    GroupPreviewOut,
    GroupSummaryOut,
    JoinGroupIn,
    Period,
)
from app.schemas.profile import ProfileOut
from app.services import groups, profile
from app.services.me import remember_time_zone

router = APIRouter(tags=["groups"])
Code = Path(min_length=4, max_length=16)


@router.get("/groups")
def list_groups(user: CurrentUser, db: DbSession, now: Now) -> list[GroupSummaryOut]:
    return groups.my_groups(db, user, now)


@router.post("/groups", status_code=201)
def create_group(
    body: CreateGroupIn, user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone
) -> GroupOut:
    remember_time_zone(db, user, time_zone)
    return groups.create_group(db, user, body.name, body.nickname, time_zone, now)


@router.get("/groups/join/{code}", dependencies=[Depends(limit_joins)])
def preview_invite(user: CurrentUser, db: DbSession, code: str = Code) -> GroupPreviewOut:
    return groups.preview(db, user, code)


@router.post("/groups/join/{code}", dependencies=[Depends(limit_joins)])
def join_group(
    body: JoinGroupIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    code: str = Code,
) -> GroupOut:
    remember_time_zone(db, user, time_zone)
    return groups.join(db, user, code, body.nickname, now)


@router.get("/groups/{group_id}/board")
def group_board(
    group_id: UUID, user: CurrentUser, db: DbSession, now: Now, period: Period = "week"
) -> BoardOut:
    """The members' statistics over a week, a month or all time, ranked three ways (ADR 0023)."""
    return groups.board(db, user, group_id, now, period)


@router.get("/groups/{group_id}/members/{member_id}/profile")
def member_profile(
    group_id: UUID, member_id: UUID, user: CurrentUser, db: DbSession, now: Now
) -> ProfileOut:
    return profile.member_profile(db, user, group_id, member_id, now)


@router.delete("/groups/{group_id}/members/me", status_code=204)
def leave_group(group_id: UUID, user: CurrentUser, db: DbSession) -> Response:
    groups.leave(db, user, group_id)
    return Response(status_code=204)


@router.delete("/groups/{group_id}/members/{member_id}", status_code=204)
def remove_member(group_id: UUID, member_id: UUID, user: CurrentUser, db: DbSession) -> Response:
    groups.remove_member(db, user, group_id, member_id)
    return Response(status_code=204)
