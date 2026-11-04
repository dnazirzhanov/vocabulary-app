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
from app.models import Group, GroupMember, User, UserWordProgress
from app.schemas.groups import (
    BehindOut,
    BoardOut,
    BoardRow,
    GroupOut,
    GroupPreviewOut,
    GroupSummaryOut,
    MemberDeckOut,
    Period,
    TodayMemberOut,
    TotalsOut,
)
from app.services.decks import board_assignments, member_deck_progress
from app.services.group_rights import actions_for, require
from app.services.progress import local_day_bounds
from app.services.promise import (
    load_promises,
    month_misses,
    promised_week,
    today_state,
    week_states,
    weekdays_of,
)
from app.services.scheduling import local_date
from app.services.study_days import StudyDay, days_by_user, week_of

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
        can=actions_for(member.role),
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
    """My groups, each with its pulse (ADR 0023, 0039): how many kept today's promise, and me."""
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
                today_promised=week.today_promised,
                today_done=week.today_done,
                my_today=me.promise_today,
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


def _member_of(db: Session, group: Group, member_id: UUID) -> GroupMember:
    target = db.scalar(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group.id)
    )
    if target is None:
        raise ApiError(404, "member_not_found", "Member not found")
    return target


def leave(db: Session, user: User, group_id: UUID, successor: UUID | None = None) -> None:
    """Anyone may leave. An owner names who takes over; without a name the longest-standing member
    does, which keeps deleting an account simple (ADR 0040)."""
    group, member = membership(db, user, group_id)
    if successor is not None:
        require(member.role, "transfer_ownership", "not_owner", "Only the owner hands a group over")
        new_owner = _member_of(db, group, successor)
        if new_owner.id == member.id:
            raise ApiError(409, "already_owner", "Name someone else to take the group over")
        new_owner.role, member.role = "owner", "member"
    _leave(db, group, member)
    db.commit()


def remove_member(db: Session, user: User, group_id: UUID, member_id: UUID) -> None:
    group, me = membership(db, user, group_id)
    require(me.role, "remove_member", "not_owner", "Only the group's owner can remove members")
    target = _member_of(db, group, member_id)
    if target.id == me.id:
        raise ApiError(409, "cannot_remove_self", "Leave the group instead")
    _leave(db, group, target)
    db.commit()


def rename_group(db: Session, user: User, group_id: UUID, name: str) -> GroupOut:
    group, me = membership(db, user, group_id)
    require(me.role, "rename")
    group.name = clean_group_name(name)
    db.commit()
    return _group_out(db, group, me)


def reset_invite(db: Session, user: User, group_id: UUID) -> GroupOut:
    """A new invite code; the old link stops working (ADR 0040)."""
    group, me = membership(db, user, group_id)
    require(me.role, "reset_invite")
    for _ in range(5):
        group.invite_code = new_invite_code()
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
    else:
        raise ApiError(503, "code_unavailable", "Could not create an invite code; try again")
    db.commit()
    return _group_out(db, group, me)


def transfer_ownership(db: Session, user: User, group_id: UUID, member_id: UUID) -> GroupOut:
    """The owner hands the group to a member and becomes an ordinary member."""
    group, me = membership(db, user, group_id)
    require(me.role, "transfer_ownership", "not_owner", "Only the owner hands a group over")
    target = _member_of(db, group, member_id)
    if target.id == me.id:
        raise ApiError(409, "already_owner", "You already own this group")
    target.role, me.role = "owner", "member"
    db.commit()
    return _group_out(db, group, me)


def delete_group(db: Session, user: User, group_id: UUID) -> None:
    """The group, its memberships and its assignments go; the decks and what everyone learned
    stay with their owners (ADR 0040)."""
    group, me = membership(db, user, group_id)
    require(me.role, "delete_group")
    db.delete(group)
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


def score(row: BoardRow) -> tuple[int, int]:
    """What a place is decided by (ADR 0027): words learned, then days studied."""
    return (row.learned, row.days)


def places(rows: list[BoardRow]) -> dict[UUID, int | None]:
    """Places by `score`, highest first; equal scores share a place (1, 2, 2, 4). A member who
    answered nothing in the period gets no place."""
    ordered = sorted((row for row in rows if row.cards > 0), key=score, reverse=True)
    result: dict[UUID, int | None] = {row.member_id: None for row in rows}
    previous: tuple[tuple[int, int], int] | None = None
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
    query = select(UserWordProgress.user_id, func.count()).where(
        UserWordProgress.user_id.in_([user.id for user in users]),
        UserWordProgress.first_recalled_at < until,
    )
    if since is not None:
        query = query.where(UserWordProgress.first_recalled_at >= since)
    counts: dict[UUID, int] = dict(
        db.execute(query.group_by(UserWordProgress.user_id)).tuples().all()
    )
    return {user.id: int(counts.get(user.id, 0)) for user in users}


def _met(db: Session, users: list[User]) -> dict[UUID, int]:
    """Words each learner has met in all (a word in two decks counts once)."""
    counts: dict[UUID, int] = dict(
        db.execute(
            select(UserWordProgress.user_id, func.count())
            .where(UserWordProgress.user_id.in_([user.id for user in users]))
            .group_by(UserWordProgress.user_id)
        )
        .tuples()
        .all()
    )
    return {user.id: int(counts.get(user.id, 0)) for user in users}


def board(
    db: Session, user: User, group_id: UUID, now: datetime, period: Period = "week"
) -> BoardOut:
    """The group's report (ADR 0039): for each member the promise this week and this month, today,
    and the words known; the days are the group's (its time zone). Places by words learned are
    still computed (`rank`) for later games, but nothing shows them."""
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

    users = [member_user for _, member_user in members]
    # Only the days this page shows: a year of them for a whole class was 240 KB from the database
    # on every look (ADR 0044). The week can start in last month; the month's misses need its start.
    oldest = first if first is not None else date(2000, 1, 1)
    oldest = min(oldest, days[0], today.replace(day=1))
    studied = days_by_user(db, users, local_day_bounds(oldest, zone)[0], zone)
    promises = load_promises(db, users)
    learned = _learned(
        db,
        users,
        local_day_bounds(first, zone)[0] if first else None,
        local_day_bounds(last, zone)[1],
    )
    known = _learned(db, users, None, now + timedelta(days=1))
    met = _met(db, users)
    assignments = board_assignments(
        db, group.id, me, [member for member, _ in members], today, zone
    )
    deck_progress = member_deck_progress(
        db, [given.deck_id for given in assignments], [member_user.id for member_user in users]
    )

    def in_period(day: StudyDay) -> bool:
        return (first is None or day.day >= first) and day.day <= last

    rows: list[BoardRow] = []
    promised_today: set[UUID] = set()  # members whose promise includes today
    for member, member_user in members:
        mine = studied[member_user.id]
        promise = promises[member_user.id]
        if promise.promised_on(today):
            promised_today.add(member.id)
        # The day after joining is the first that can be missed.
        first_counted = local_date(member.joined_at, zone) + timedelta(days=1)
        counted = [day for day in mine.values() if in_period(day)]
        state = today_state(promise, mine, today)
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
                promised_days=sum(promised_week(promise, today)),
                week=[day in mine and mine[day].studied for day in days],
                studied_today=state == "done",
                week_states=week_states(promise, mine, today, first_counted),
                month_misses=month_misses(promise, mine, today, first_counted),
                promise_today=state,
                promise_weekdays=weekdays_of(promise.mask_on(today)),
                paused=bool(promise.pause and promise.pause[0] <= today <= promise.pause[1]),
                known=known[member_user.id],
                learning=max(0, met[member_user.id] - known[member_user.id]),
                decks=[
                    MemberDeckOut(
                        deck_id=given.deck_id,
                        title=given.title,
                        word_count=given.word_count,
                        met=deck_progress.get((given.deck_id, member_user.id), (0, 0))[0],
                        learned=deck_progress.get((given.deck_id, member_user.id), (0, 0))[1],
                    )
                    for given in assignments
                ],
            )
        )
    places_by = places(rows)
    rows = [row.model_copy(update={"rank": places_by[row.member_id]}) for row in rows]
    # Me first, then alphabetical: the report is a list of friends, never an order of merit.
    rows.sort(key=lambda row: (not row.is_me, row.nickname.casefold()))
    return BoardOut(
        group=_group_out(db, group, me),
        today=today,
        today_promised=len(promised_today),
        today_done=sum(
            row.promise_today == "done" for row in rows if row.member_id in promised_today
        ),
        week_start=days[0],
        week_end=days[-1],
        period=period,
        period_start=first,
        period_end=last,
        rows=rows,
        totals=TotalsOut(
            days=sum(row.days for row in rows),
            learned=sum(row.learned for row in rows),
            cards=sum(row.cards for row in rows),
        ),
        assignments=assignments,
    )
