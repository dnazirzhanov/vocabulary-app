"""Friend groups and their board (ADR 0011, 0023).

Motivation comes largely from other people, so learners can study alongside friends or a class.
Learners may be minors, so a group shows nicknames only, has no chat, and is joined by an invite
code. The board is the members' statistics over a week, a month or all time (ADR 0023), ranked
by one score: words learned — recalled in a review a day or more after meeting them (ADR 0027).
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
from app.schemas.groups import (
    BehindOut,
    BoardOut,
    BoardRow,
    GroupOut,
    GroupPreviewOut,
    GroupSummaryOut,
    Period,
    TodayMemberOut,
    TotalsOut,
)
from app.services.decks import board_assignments
from app.services.progress import local_day_bounds
from app.services.scheduling import local_date
from app.services.study_days import (
    HISTORY_DAYS,
    StudyDay,
    days_by_user,
    promises_by_user,
    week_days,
    week_of,
    week_streak,
    zone_of,
)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I to misread
CODE_LENGTH = 8
MAX_GROUPS_PER_USER = 5
MAX_MEMBERS = 50

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


def my_groups(db: Session, user: User, now: datetime) -> list[GroupSummaryOut]:
    """My groups, each with its pulse (ADR 0023): my place this week and who studied today."""
    rows = db.execute(
        select(Group, GroupMember)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
        .order_by(GroupMember.joined_at)
    ).all()
    summaries: list[GroupSummaryOut] = []
    for group, member in rows:
        week = board(db, user, group.id, now, "week")
        me = next(row for row in week.rows if row.is_me)
        summaries.append(
            GroupSummaryOut(
                **_group_out(db, group, member).model_dump(),
                behind_for_class=_most_behind(week),
                my_rank=me.rank,
                ranked=sum(row.rank is not None for row in week.rows),
                members=[
                    TodayMemberOut(
                        nickname=row.nickname, is_me=row.is_me, studied_today=row.studied_today
                    )
                    for row in week.rows
                ],
            )
        )
    return summaries


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


def _most_behind(week: BoardOut) -> BehindOut | None:
    """Of my decks with a deadline, the one I lack most words for; None when I keep up."""
    late = [
        (item.title, item.my_standing)
        for item in week.assignments
        if item.my_standing is not None
        and item.my_standing.behind > 0
        and item.my_standing.status in ("behind", "not_started")
    ]
    if not late:
        return None
    title, standing = max(late, key=lambda pair: pair[1].behind)
    status = "behind" if standing.status == "behind" else "not_started"
    return BehindOut(title=title, behind=standing.behind, status=status)


# --- the board ------------------------------------------------------------------------------


def score(row: BoardRow) -> tuple[int, int, int]:
    """What a place is decided by (ADR 0027): words learned, then days studied, then weeks in a
    row with the promise kept."""
    return (row.learned, row.days, row.streak_weeks)


def places(rows: list[BoardRow]) -> dict[UUID, int | None]:
    """Places by `score`, highest first; equal scores share a place (1, 2, 2, 4). A member who
    answered nothing in the period gets no place."""
    ordered = sorted((row for row in rows if row.cards > 0), key=score, reverse=True)
    result: dict[UUID, int | None] = {row.member_id: None for row in rows}
    previous: tuple[tuple[int, int, int], int] | None = None
    for index, row in enumerate(ordered):
        value = score(row)
        place = previous[1] if previous and previous[0] == value else index + 1
        result[row.member_id] = place
        previous = (value, place)
    return result


def rank(rows: list[BoardRow]) -> list[BoardRow]:
    """Every row with its place, best first; members without a place come last, by nickname."""
    by = places(rows)
    ranked = [row.model_copy(update={"rank": by[row.member_id]}) for row in rows]
    return sorted(
        ranked, key=lambda row: (row.rank is None, row.rank or 0, row.nickname.casefold())
    )


def period_bounds(period: Period, today: date) -> tuple[date | None, date]:
    """[first, last] local days of the period; all time has no first day."""
    if period == "week":
        days = week_of(today)
        return days[0], days[-1]
    if period == "month":
        first = today.replace(day=1)
        following = (first + timedelta(days=32)).replace(day=1)
        return first, following - timedelta(days=1)
    return None, today


def _learned(
    db: Session, users: list[User], since: datetime | None, until: datetime
) -> dict[UUID, int]:
    """Words each learner first recalled in a later review (`was_review`, any answer but
    «Снова»: the «Прогресс» definition, ADR 0022) within [since, until)."""
    first = (
        select(
            ReviewAttempt.user_id,
            ReviewAttempt.word_id,
            func.min(ReviewAttempt.answered_at).label("at"),
        )
        .where(
            ReviewAttempt.user_id.in_([user.id for user in users]),
            ReviewAttempt.was_review.is_(True),
            ReviewAttempt.rating >= 2,
        )
        .group_by(ReviewAttempt.user_id, ReviewAttempt.word_id)
        .subquery()
    )
    query = select(first.c.user_id, func.count()).where(first.c.at < until)
    if since is not None:
        query = query.where(first.c.at >= since)
    counts: dict[UUID, int] = dict(db.execute(query.group_by(first.c.user_id)).tuples().all())
    return {user.id: int(counts.get(user.id, 0)) for user in users}


def board(
    db: Session, user: User, group_id: UUID, now: datetime, period: Period = "week"
) -> BoardOut:
    group, me = membership(db, user, group_id)
    members = db.execute(
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group.id)
    ).all()
    zone = ZoneInfo(group.time_zone)
    today = local_date(now, zone)
    days = week_of(today)
    first, last = period_bounds(period, today)

    # Everyone's days, each member's counted in their own time zone (ADR 0011, 0015).
    users = [member_user for _, member_user in members]
    history = HISTORY_DAYS if period != "all" else 365 * 30
    since = now - timedelta(days=history + 1)
    studied = days_by_user(db, users, since)
    promises = promises_by_user(db, users, since)
    learned = _learned(
        db,
        users,
        local_day_bounds(first, zone)[0] if first else None,
        local_day_bounds(last, zone)[1],
    )

    def in_period(day: StudyDay) -> bool:
        return (first is None or day.day >= first) and day.day <= last

    rows: list[BoardRow] = []
    for member, member_user in members:
        mine = studied[member_user.id]
        promised = promises[member_user.id].get(days[0], member_user.study_days_per_week)
        week = week_days(mine, days, promised)
        member_today = local_date(now, zone_of(member_user))
        counted = [day for day in mine.values() if in_period(day)]
        rows.append(
            BoardRow(
                member_id=member.id,
                nickname=member.nickname,
                role=member.role,
                is_me=member.id == me.id,
                learned=learned[member_user.id],
                days=sum(day.studied for day in counted),
                cards=sum(day.answers for day in counted),
                rank=None,
                promised_days=promised,
                week=week.studied,
                streak_weeks=week_streak(
                    mine,
                    promises[member_user.id],
                    member_user.study_days_per_week,
                    member_today,
                ),
                studied_today=member_today in mine and mine[member_today].studied,
            )
        )

    return BoardOut(
        group=_group_out(db, group, me),
        week_start=days[0],
        week_end=days[-1],
        period=period,
        period_start=first,
        period_end=last,
        rows=rank(rows),
        totals=TotalsOut(
            days=sum(row.days for row in rows),
            learned=sum(row.learned for row in rows),
            cards=sum(row.cards for row in rows),
        ),
        assignments=board_assignments(
            db, group.id, me, [member for member, _ in members], today, zone
        ),
    )
