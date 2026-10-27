"""Attempt points, introductions, local days and recall: the base rules others build on.

Points are stored per attempt (ADR 0008, revised by ADR 0012) and recognise an introduction; they
are no longer shown or used for a day's result, which is the plan (ADR 0015, services/plan_days).
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import LearningSession, ReviewAttempt, User
from app.services.scheduling import AGAIN

INTRODUCED_POINTS = 10  # a new word's first showing
REVIEWED_POINTS = 5  # a review card, whatever the rating: self-rating is never rewarded
RECALL_RATE_DAYS = 30


# An attempt that introduced a word: the old introduce step, or a new card's first (scored) rating.
INTRODUCTION = or_(
    ReviewAttempt.exercise_type == "introduce",
    and_(
        ReviewAttempt.exercise_type == "card",
        ReviewAttempt.was_review.is_(False),
        ReviewAttempt.points > 0,
    ),
)


def card_points(practice: bool, first_showing: bool, was_review: bool) -> int:
    """Points for one rated card (ADR 0012). They never depend on the rating, so pressing
    «Легко» earns nothing extra; practice and repeat showings in a session earn nothing."""
    if practice:
        return 0
    if first_showing:
        return INTRODUCED_POINTS
    return REVIEWED_POINTS if was_review else 0


def local_day_bounds(day: date, time_zone: ZoneInfo) -> tuple[datetime, datetime]:
    """[start, end) of a local calendar day as aware datetimes. A DST day is 23 or 25 hours long."""
    start = datetime.combine(day, time.min, tzinfo=time_zone)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=time_zone)
    return start, end


# --- database-backed views ------------------------------------------------------------------


def recall_counts(db: Session, user: User, now: datetime) -> tuple[int, int]:
    """(recalled, reviewed): review cards rated anything but «Снова» over the last
    RECALL_RATE_DAYS — recall after a delay, not first showings or learning steps."""
    reviewed, recalled = db.execute(
        select(func.count(), func.count().filter(ReviewAttempt.rating != AGAIN))
        .join(LearningSession, LearningSession.id == ReviewAttempt.session_id)
        .where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.exercise_type == "card",
            ReviewAttempt.was_review.is_(True),
            LearningSession.kind == "study",
            ReviewAttempt.answered_at >= now - timedelta(days=RECALL_RATE_DAYS),
        )
    ).one()
    return int(recalled), int(reviewed)
