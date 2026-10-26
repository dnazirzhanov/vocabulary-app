"""The learner's own settings."""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import User
from app.schemas.me import MeOut, MeUpdate


def me_out(user: User) -> MeOut:
    return MeOut(
        daily_target_words=user.daily_target_words,
        study_days_per_week=user.study_days_per_week,
        ramp_enabled=user.ramp_enabled,
        onboarded=user.onboarded_at is not None,
        onboarded_at=user.onboarded_at,
    )


def update_me(db: Session, user: User, changes: MeUpdate, now: datetime) -> MeOut:
    for field in changes.model_fields_set:
        value = getattr(changes, field)
        if value is not None:  # null is "leave as is"; a target cannot be unset
            setattr(user, field, value)
    # Choosing a pace finishes the first-run screens and starts the ramp's clock.
    if user.onboarded_at is None and user.daily_target_words is not None:
        user.onboarded_at = now
    db.commit()
    return me_out(user)


def remember_time_zone(db: Session, user: User, time_zone: ZoneInfo) -> None:
    """Keep the browser's zone for group boards, which count each member's days in their own
    zone. Only zones PostgreSQL knows are stored, so the board query can never fail on one."""
    if user.time_zone == time_zone.key:
        return
    known = db.scalar(
        text("SELECT count(*) FROM pg_timezone_names WHERE name = :zone"), {"zone": time_zone.key}
    )
    if known:
        user.time_zone = time_zone.key
        db.commit()
