"""Friend groups: create, join by invite code, rename, leave, hand over, and the weekly board."""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, SentTimeZone, TimeZone
from app.core.ratelimit import limit_joins
from app.schemas.groups import (
    BoardOut,
    CreateGroupIn,
    GroupOut,
    GroupPreviewOut,
    GroupSummaryOut,
    JoinGroupIn,
    Period,
    RenameGroupIn,
    TransferIn,
)
from app.services import group_tests, groups
from app.services.me import remember_time_zone

router = APIRouter(tags=["groups"])
Code = Path(min_length=4, max_length=16)


@router.get("/groups")
def list_groups(user: CurrentUser, db: DbSession, now: Now) -> list[GroupSummaryOut]:
    return groups.my_groups(db, user, now)


@router.post("/groups", status_code=201)
def create_group(
    body: CreateGroupIn,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    time_zone: TimeZone,
    sent_zone: SentTimeZone,
) -> GroupOut:
    remember_time_zone(db, user, sent_zone)
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
    sent_zone: SentTimeZone,
    code: str = Code,
) -> GroupOut:
    remember_time_zone(db, user, sent_zone)
    return groups.join(db, user, code, body.nickname, now)


@router.get("/groups/{group_id}/board")
def group_board(
    group_id: UUID, user: CurrentUser, db: DbSession, now: Now, period: Period = "week"
) -> BoardOut:
    """The members' statistics over a week, a month or all time, ranked three ways (ADR 0023)."""
    out = groups.board(db, user, group_id, now, period)
    out.latest_test = group_tests.latest_test(db, group_id, now)
    return out


@router.patch("/groups/{group_id}")
def rename_group(group_id: UUID, body: RenameGroupIn, user: CurrentUser, db: DbSession) -> GroupOut:
    return groups.rename_group(db, user, group_id, body.name)


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: UUID, user: CurrentUser, db: DbSession) -> Response:
    groups.delete_group(db, user, group_id)
    return Response(status_code=204)


@router.post("/groups/{group_id}/invite")
def reset_invite(group_id: UUID, user: CurrentUser, db: DbSession) -> GroupOut:
    """A new invite link; the old one stops working."""
    return groups.reset_invite(db, user, group_id)


@router.put("/groups/{group_id}/owner")
def transfer_ownership(
    group_id: UUID, body: TransferIn, user: CurrentUser, db: DbSession
) -> GroupOut:
    return groups.transfer_ownership(db, user, group_id, body.member_id)


@router.delete("/groups/{group_id}/members/me", status_code=204)
def leave_group(
    group_id: UUID, user: CurrentUser, db: DbSession, successor: UUID | None = None
) -> Response:
    """Leave; an owner names the member who takes the group over (`successor`)."""
    groups.leave(db, user, group_id, successor)
    return Response(status_code=204)


@router.delete("/groups/{group_id}/members/{member_id}", status_code=204)
def remove_member(group_id: UUID, member_id: UUID, user: CurrentUser, db: DbSession) -> Response:
    groups.remove_member(db, user, group_id, member_id)
    return Response(status_code=204)
