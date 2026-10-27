"""The profile window (ADR 0015): a learner's week against their own promise, and the learning
they did beyond it. Anyone can see their own; group members can see each other's, opened from a
board, counted over that board's week."""

from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import GroupMember, User
from app.schemas.profile import ExtraOut, ProfileOut
from app.services.groups import membership
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
from app.services.progress_view import word_stages
from app.services.scheduling import local_date


def _profile(
    db: Session,
    user: User,
    now: datetime,
    week: list[date],
    today: date,
    time_zone: ZoneInfo | None,
    nickname: str | None,
    is_me: bool,
) -> ProfileOut:
    since = now - timedelta(days=HISTORY_DAYS + 1)
    days = days_by_user(db, [user], since, time_zone)[user.id]
    promises = promises_by_user(db, [user], since, time_zone)[user.id]
    promised = promises.get(week[0], user.study_days_per_week)
    plan = week_plan(days, week, promised)
    own_today = local_date(now, time_zone or zone_of(user))
    return ProfileOut(
        nickname=nickname,
        is_me=is_me,
        week_start=week[0],
        week_end=week[-1],
        words_per_day=target_of(user),
        promised_days=promised,
        plan_days=plan.plan_days,
        week=plan.done,
        today_index=week.index(today) if today in week else 6,
        planned_words=plan.planned_new,
        streak_weeks=week_streak(days, promises, user.study_days_per_week, own_today),
        words_total=word_stages(db, user, now).introduced,
        extra=ExtraOut(new_words=plan.extra_new, practice_answers=plan.practice_answers),
    )


def own_profile(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> ProfileOut:
    today = local_date(now, time_zone)
    return _profile(db, user, now, week_of(today), today, time_zone, None, True)


def member_profile(
    db: Session, user: User, group_id: UUID, member_id: UUID, now: datetime
) -> ProfileOut:
    """Members only, and only for a member of that group: anything else looks like nothing."""
    group, me = membership(db, user, group_id)
    member = db.scalar(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group.id)
    )
    if member is None:
        raise ApiError(404, "member_not_found", "Member not found")
    member_user = db.get_one(User, member.user_id)
    # The board's week, each member's days in their own zone, so the window matches the row.
    today = local_date(now, ZoneInfo(group.time_zone))
    return _profile(
        db, member_user, now, week_of(today), today, None, member.nickname, member.id == me.id
    )
