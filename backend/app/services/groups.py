"""Friend groups and their weekly board (ADR 0011).

Motivation comes largely from other people, so learners can study alongside friends or a class.
Learners may be minors, so a group shows nicknames only, has no chat, and is joined by an invite
code. The board ranks by days practised this week (then points), so showing up beats speed: a
learner on 3 words a day can top a board that also holds a 100-words-a-day learner.
"""

import re
import secrets
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Group, GroupMember, ReviewAttempt, User
from app.schemas.groups import BoardOut, BoardRow, GroupGoal, GroupOut, GroupPreviewOut
from app.services.pace import target_of
from app.services.progress import DAILY_GOAL_POINTS, STREAK_HISTORY_DAYS, streak
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


def _membership(db: Session, user: User, group_id: UUID) -> tuple[Group, GroupMember]:
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
    group, member = _membership(db, user, group_id)
    _leave(db, group, member)
    db.commit()


def remove_member(db: Session, user: User, group_id: UUID, member_id: UUID) -> None:
    group, me = _membership(db, user, group_id)
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


def week_of(today: date) -> list[date]:
    monday = today - timedelta(days=today.weekday())
    return [monday + timedelta(days=n) for n in range(7)]


def rank(rows: list[BoardRow]) -> list[BoardRow]:
    """Days practised, then points; equal results share a place (1, 2, 2, 4). Members with no
    points this week get no place and come last, by nickname."""
    active = sorted(
        (row for row in rows if row.points > 0),
        key=lambda row: (-row.days_practised, -row.points, row.nickname.casefold()),
    )
    ranked: list[BoardRow] = []
    for index, row in enumerate(active):
        previous = ranked[-1] if ranked else None
        same = previous is not None and (previous.days_practised, previous.points) == (
            row.days_practised,
            row.points,
        )
        ranked.append(
            row.model_copy(update={"rank": previous.rank if same and previous else index + 1})
        )
    resting = sorted(
        (row for row in rows if row.points == 0), key=lambda row: row.nickname.casefold()
    )
    return ranked + [row.model_copy(update={"rank": None}) for row in resting]


def board(db: Session, user: User, group_id: UUID, now: datetime) -> BoardOut:
    group, me = _membership(db, user, group_id)
    members = db.execute(
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group.id)
    ).all()
    days = week_of(local_date(now, ZoneInfo(group.time_zone)))

    # One query for everyone: points and new words per member per local day, each member's days
    # counted in their own time zone (stored zones are checked against PostgreSQL's list).
    zone = func.coalesce(User.time_zone, "UTC")
    local_day = func.date(func.timezone(zone, ReviewAttempt.answered_at))
    history = db.execute(
        select(
            ReviewAttempt.user_id,
            local_day,
            func.sum(ReviewAttempt.points),
            func.count().filter(ReviewAttempt.exercise_type == "introduce"),
        )
        .join(User, User.id == ReviewAttempt.user_id)
        .where(
            ReviewAttempt.user_id.in_([member_user.id for _, member_user in members]),
            ReviewAttempt.answered_at >= now - timedelta(days=STREAK_HISTORY_DAYS + 1),
        )
        .group_by(ReviewAttempt.user_id, local_day)
    )
    points: dict[UUID, dict[date, int]] = {}
    new_words: dict[UUID, dict[date, int]] = {}
    for user_id, day, day_points, introduced in history:
        points.setdefault(user_id, {})[day] = int(day_points or 0)
        new_words.setdefault(user_id, {})[day] = int(introduced or 0)

    rows: list[BoardRow] = []
    goal_done = goal_target = 0
    for member, member_user in members:
        by_day = points.get(member_user.id, {})
        met = [by_day.get(day, 0) >= DAILY_GOAL_POINTS for day in days]
        member_today = local_date(now, ZoneInfo(member_user.time_zone or "UTC"))
        rows.append(
            BoardRow(
                member_id=member.id,
                nickname=member.nickname,
                role=member.role,
                is_me=member.id == me.id,
                rank=None,
                days_practised=sum(met),
                week=met,
                points=sum(by_day.get(day, 0) for day in days),
                streak_days=streak(
                    (day for day, total in by_day.items() if total >= DAILY_GOAL_POINTS),
                    member_today,
                ),
            )
        )
        goal_done += sum(new_words.get(member_user.id, {}).get(day, 0) for day in days)
        goal_target += target_of(member_user) * member_user.study_days_per_week

    return BoardOut(
        group=_group_out(db, group, me),
        week_start=days[0],
        week_end=days[-1],
        rows=rank(rows),
        goal=GroupGoal(done=goal_done, target=max(GOAL_FLOOR, goal_target)),
    )
