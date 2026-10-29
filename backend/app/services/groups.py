"""Friend groups and their weekly board (ADR 0011).

Motivation comes largely from other people, so learners can study alongside friends or a class.
Learners may be minors, so a group shows nicknames only, has no chat, and is joined by an invite
code. The board ranks by the share of each member's own promise kept this week (ADR 0015), so
keeping a pace beats volume: a learner on 3 words a day, 3 days a week, can top a board that
also holds a 100-words-a-day learner.
"""

import re
import secrets
from datetime import datetime, timedelta
from fractions import Fraction
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Group, GroupMember, User
from app.schemas.groups import BoardOut, BoardRow, GroupGoal, GroupOut, GroupPreviewOut
from app.services.decks import board_assignments
from app.services.pace import target_of
from app.services.plan_days import (
    HISTORY_DAYS,
    days_by_user,
    promises_by_user,
    week_of,
    week_plan,
    week_streak,
    zone_of,
)
from app.services.scheduling import local_date

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I to misread
CODE_LENGTH = 8
MAX_GROUPS_PER_USER = 5
MAX_MEMBERS = 50
GOAL_FLOOR = 20

_NICKNAME = re.compile(r"[A-Za-zА-Яа-яЁё0-9 -]{2,20}")
_LINK_LIKE = re.compile(r"(https?|www)", re.IGNORECASE)


# --- input rules ----------------------------------------------------------------------------


def _squash(text: str) -> str:
    return " ".join(text.split())


def clean_nickname(raw: str) -> str:
    """Letters, digits, spaces and hyphens, 2–20 characters. Nothing that could carry contact
    details: no links, no e-mail (the alphabet has no "@" or "."), no phone-like digit runs."""
    nickname = _squash(raw)
    if not _NICKNAME.fullmatch(nickname):
        raise ApiError(422, "invalid_nickname", "Use 2–20 letters, digits, spaces or hyphens")
    digits = sum(character.isdigit() for character in nickname)
    if digits >= 5 or digits == len(nickname.replace(" ", "").replace("-", "")):
        raise ApiError(422, "invalid_nickname", "A nickname cannot be a number")
    if _LINK_LIKE.search(nickname):
        raise ApiError(422, "invalid_nickname", "A nickname cannot contain a link")
    return nickname


def clean_group_name(raw: str) -> str:
    name = _squash(raw)
    if not 2 <= len(name) <= 40 or "@" in name or _LINK_LIKE.search(name) or "<" in name:
        raise ApiError(422, "invalid_group_name", "Use 2–40 characters, without links")
    return name


def normalize_code(raw: str) -> str:
    return re.sub(r"[\s-]", "", raw).upper()


def new_invite_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


# --- reading --------------------------------------------------------------------------------


def _member_count(db: Session, group_id: UUID) -> int:
    count = db.scalar(select(func.count()).where(GroupMember.group_id == group_id))
    return int(count or 0)


def _group_out(db: Session, group: Group, member: GroupMember) -> GroupOut:
    return GroupOut(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        member_count=_member_count(db, group.id),
        role=member.role,
        nickname=member.nickname,
    )


def membership(db: Session, user: User, group_id: UUID) -> tuple[Group, GroupMember]:
    # Someone else's group is indistinguishable from a missing one.
    row = db.execute(
        select(Group, GroupMember)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(Group.id == group_id, GroupMember.user_id == user.id)
    ).one_or_none()
    if row is None:
        raise ApiError(404, "group_not_found", "Group not found")
    return row[0], row[1]


def my_groups(db: Session, user: User) -> list[GroupOut]:
    rows = db.execute(
        select(Group, GroupMember)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
        .order_by(GroupMember.joined_at)
    )
    return [_group_out(db, group, member) for group, member in rows]


def _group_by_code(db: Session, code: str) -> Group:
    group = db.scalar(select(Group).where(Group.invite_code == normalize_code(code)))
    if group is None:
        raise ApiError(404, "invite_not_found", "This invite code does not exist")
    return group


def preview(db: Session, user: User, code: str) -> GroupPreviewOut:
    group = _group_by_code(db, code)
    member = db.scalar(
        select(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == user.id)
    )
    return GroupPreviewOut(
        name=group.name, member_count=_member_count(db, group.id), already_member=member is not None
    )


# --- changing -------------------------------------------------------------------------------


def _require_room_for_another_group(db: Session, user: User) -> None:
    count = db.scalar(select(func.count()).where(GroupMember.user_id == user.id))
    if (count or 0) >= MAX_GROUPS_PER_USER:
        raise ApiError(409, "too_many_groups", f"At most {MAX_GROUPS_PER_USER} groups per learner")


def _add_member(
    db: Session, group: Group, user: User, nickname: str, role: str, now: datetime
) -> GroupMember:
    member = GroupMember(
        group_id=group.id, user_id=user.id, nickname=nickname, role=role, joined_at=now
    )
    db.add(member)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            409, "nickname_taken", "Someone in this group already has that nickname"
        ) from exc
    return member


def create_group(
    db: Session, user: User, name: str, nickname: str, time_zone: ZoneInfo, now: datetime
) -> GroupOut:
    _require_room_for_another_group(db, user)
    clean_name, clean_nick = clean_group_name(name), clean_nickname(nickname)
    for _ in range(5):  # 32^8 codes: a collision is very unlikely, but not impossible
        group = Group(name=clean_name, invite_code=new_invite_code(), time_zone=time_zone.key)
        db.add(group)
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
    else:
        raise ApiError(503, "code_unavailable", "Could not create an invite code; try again")
    member = _add_member(db, group, user, clean_nick, "owner", now)
    db.commit()
    return _group_out(db, group, member)


def join(db: Session, user: User, code: str, nickname: str, now: datetime) -> GroupOut:
    group = _group_by_code(db, code)
    existing = db.scalar(
        select(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == user.id)
    )
    if existing is not None:  # a second tap on the link: already in
        return _group_out(db, group, existing)
    _require_room_for_another_group(db, user)
    if _member_count(db, group.id) >= MAX_MEMBERS:
        raise ApiError(409, "group_full", f"A group holds at most {MAX_MEMBERS} learners")
    member = _add_member(db, group, user, clean_nickname(nickname), "member", now)
    db.commit()
    return _group_out(db, group, member)


def _leave(db: Session, group: Group, member: GroupMember) -> None:
    db.delete(member)
    db.flush()
    remaining = list(
        db.scalars(
            select(GroupMember)
            .where(GroupMember.group_id == group.id)
            .order_by(GroupMember.joined_at)
        )
    )
    if not remaining:
        db.delete(group)
    elif member.role == "owner":
        remaining[0].role = "owner"  # the longest-standing member takes over


def leave(db: Session, user: User, group_id: UUID) -> None:
    group, member = membership(db, user, group_id)
    _leave(db, group, member)
    db.commit()


def remove_member(db: Session, user: User, group_id: UUID, member_id: UUID) -> None:
    group, me = membership(db, user, group_id)
    if me.role != "owner":
        raise ApiError(403, "not_owner", "Only the group's owner can remove members")
    target = db.scalar(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group.id)
    )
    if target is None:
        raise ApiError(404, "member_not_found", "Member not found")
    _leave(db, group, target)
    db.commit()


def leave_all(db: Session, user: User) -> None:
    """Before an account is deleted: hand over ownership and drop empty groups."""
    for member in db.scalars(select(GroupMember).where(GroupMember.user_id == user.id)):
        _leave(db, db.get_one(Group, member.group_id), member)
    db.flush()


# --- the board ------------------------------------------------------------------------------


def rank(rows: list[BoardRow], active: set[UUID]) -> list[BoardRow]:
    """The share of the promise kept this week (ADR 0015): 3 of 4 days is ahead of 1 of 6, and
    days beyond the promise add nothing. Equal shares share a place (1, 2, 2, 4). Members with no
    answers this week get no place and come last; within a place, by nickname."""

    def kept(row: BoardRow) -> Fraction:
        return Fraction(min(row.plan_days, row.promised_days), row.promised_days)

    ordered = sorted(
        (row for row in rows if row.member_id in active),
        key=lambda row: (-kept(row), row.nickname.casefold()),
    )
    ranked: list[BoardRow] = []
    for index, row in enumerate(ordered):
        previous = ranked[-1] if ranked else None
        same = previous is not None and kept(previous) == kept(row)
        ranked.append(
            row.model_copy(update={"rank": previous.rank if same and previous else index + 1})
        )
    resting = sorted(
        (row for row in rows if row.member_id not in active),
        key=lambda row: row.nickname.casefold(),
    )
    return ranked + [row.model_copy(update={"rank": None}) for row in resting]


def board(db: Session, user: User, group_id: UUID, now: datetime) -> BoardOut:
    group, me = membership(db, user, group_id)
    members = db.execute(
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group.id)
    ).all()
    days = week_of(local_date(now, ZoneInfo(group.time_zone)))

    # Everyone's days, each member's counted in their own time zone (ADR 0011, 0015).
    users = [member_user for _, member_user in members]
    since = now - timedelta(days=HISTORY_DAYS + 1)
    plan_days = days_by_user(db, users, since)
    promises = promises_by_user(db, users, since)

    rows: list[BoardRow] = []
    active: set[UUID] = set()
    goal_done = goal_target = 0
    for member, member_user in members:
        promised = promises[member_user.id].get(days[0], member_user.study_days_per_week)
        week = week_plan(plan_days[member_user.id], days, promised)
        if week.active:
            active.add(member.id)
        member_today = local_date(now, zone_of(member_user))
        rows.append(
            BoardRow(
                member_id=member.id,
                nickname=member.nickname,
                role=member.role,
                is_me=member.id == me.id,
                rank=None,
                plan_days=week.plan_days,
                promised_days=promised,
                week=week.done,
                streak_weeks=week_streak(
                    plan_days[member_user.id],
                    promises[member_user.id],
                    member_user.study_days_per_week,
                    member_today,
                ),
            )
        )
        # Each member moves the shared bar by their planned words, at most their week's plan.
        week_target = target_of(member_user) * promised
        goal_done += min(week.planned_new, week_target)
        goal_target += week_target

    return BoardOut(
        group=_group_out(db, group, me),
        week_start=days[0],
        week_end=days[-1],
        rows=rank(rows, active),
        goal=GroupGoal(done=goal_done, target=max(GOAL_FLOOR, goal_target)),
        assignments=board_assignments(db, group.id, me, [member for member, _ in members]),
    )
