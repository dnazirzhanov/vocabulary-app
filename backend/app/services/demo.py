"""Local demo data: a group of made-up classmates with a week of activity, so the board can be seen
and screenshotted without six real people (development databases only)."""

from datetime import datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    DeckWord,
    Group,
    GroupMember,
    LearningSession,
    ReviewAttempt,
    User,
    UserWordProgress,
)
from app.services.groups import new_invite_code
from app.services.plan_days import week_of
from app.services.progress import INTRODUCED_POINTS
from app.services.scheduling import local_date

DEMO_GROUP = "Демо-группа"
ZONE = ZoneInfo("Asia/Bishkek")
# Nickname and new words per day, Monday to Sunday (None: no study that day).
CLASSMATES: list[tuple[str, int, int, list[int | None]]] = [
    # (nickname, words a day, days a week promised, new words met each day Monday to Sunday)
    ("Быстрый Барсук", 20, 4, [20, 25, None, 20, None, None, None]),
    ("Тихий Лис", 3, 5, [3, 3, 3, 3, 3, None, None]),
    ("Весёлый Кот", 5, 3, [5, None, 5, 5, None, None, None]),
    ("Смелый Ёж", 10, 6, [None, 10, None, None, None, None, None]),
    ("Ранний Орёл", 4, 5, [4, 4, 4, None, None, None, None]),
    ("Сонный Панда", 5, 3, [None, None, None, None, None, None, None]),
]


def seed_classmates(db: Session, owner_subject: str, now: datetime) -> str:
    """Replaces any earlier demo group of this owner. Returns the invite code."""
    owner = db.scalar(select(User).where(User.auth_subject == owner_subject))
    if owner is None:
        owner = User(auth_subject=owner_subject)
        db.add(owner)
        db.flush()
    db.execute(delete(User).where(User.auth_subject.like("dev|classmate-%")))
    old = db.scalars(
        select(Group.id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(Group.name == DEMO_GROUP, GroupMember.user_id == owner.id)
    ).all()
    db.execute(delete(Group).where(Group.id.in_(old)))

    group = Group(name=DEMO_GROUP, invite_code=new_invite_code(), time_zone=ZONE.key)
    db.add(group)
    db.flush()
    db.add(
        GroupMember(
            group_id=group.id,
            user_id=owner.id,
            nickname="Мудрый Филин",
            role="owner",
            joined_at=now,
        )
    )

    words = list(
        db.scalars(
            select(DeckWord.word_id).where(DeckWord.deck_id == "a1-a2").order_by(DeckWord.position)
        )
    )
    days = week_of(local_date(now, ZONE))
    for number, (nickname, target, promised, plan) in enumerate(CLASSMATES, start=1):
        classmate = User(
            auth_subject=f"dev|classmate-{number}",
            time_zone=ZONE.key,
            daily_target_words=target,
            study_days_per_week=promised,
        )
        db.add(classmate)
        db.flush()
        db.add(
            GroupMember(
                group_id=group.id,
                user_id=classmate.id,
                nickname=nickname,
                role="member",
                joined_at=now,
            )
        )
        met = 0  # each classmate meets new words in deck order, so every day's words are new
        for day, count in zip(days, plan, strict=True):
            # Evening of each day so far; today's activity a little before now, so it counts.
            evening = datetime.combine(day, datetime.min.time(), tzinfo=ZONE) + timedelta(hours=18)
            moment = min(evening, now - timedelta(minutes=10 * number))
            if not count or moment.astimezone(ZONE).date() != day:
                continue
            session = LearningSession(
                id=uuid4(),
                user_id=classmate.id,
                deck_id="a1-a2",
                kind="study",
                plan=[],
                started_at=moment,
                completed_at=moment,
                day_target=target,
                promised_days=promised,
            )
            db.add(session)
            db.flush()
            for index in range(count):
                word_id = words[(met + index) % len(words)]
                db.add(
                    UserWordProgress(
                        user_id=classmate.id,
                        word_id=word_id,
                        introduced_at=moment,
                        last_seen_at=moment,
                        due_at=moment + timedelta(days=1),
                    )
                )
                db.add(
                    ReviewAttempt(
                        session_id=session.id,
                        user_id=classmate.id,
                        word_id=word_id,
                        exercise_id=f"demo-{index}",
                        exercise_type="card",
                        correct=None,
                        rating=3,
                        answered_at=moment,
                        points=INTRODUCED_POINTS,
                    )
                )
            met += count
    db.commit()
    return group.invite_code
