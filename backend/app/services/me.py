"""The learner's own settings."""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import User
from app.schemas.me import MeOut, MeUpdate
from app.services.promise import preset, promise_out, set_weekdays, weekdays_of
from app.services.scheduling import local_date


def me_out(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> MeOut:
    return MeOut(
        daily_target_words=user.daily_target_words,
        study_days_per_week=user.study_days_per_week,
        ramp_enabled=user.ramp_enabled,
        ui_language=user.ui_language,
        notify_morning=user.notify_morning,
        notify_afternoon=user.notify_afternoon,
        notify_report=user.notify_report,
        notify_deadline=user.notify_deadline,
        onboarded=user.onboarded_at is not None,
        onboarded_at=user.onboarded_at,
        promise=promise_out(db, user, local_date(now, time_zone)),
    )


def update_me(
    db: Session, user: User, changes: MeUpdate, now: datetime, time_zone: ZoneInfo
) -> MeOut:
    for field in changes.model_fields_set:
        value = getattr(changes, field)
        if value is None:  # null is "leave as is"; a target cannot be unset
            continue
        if field == "study_days_per_week":
            # The old «days a week» number is a promise on spread-out weekdays (ADR 0039).
            set_weekdays(db, user, weekdays_of(preset(value)), local_date(now, time_zone))
        else:
            setattr(user, field, value)
    # Choosing a pace finishes the first-run screens and starts the ramp's clock.
    if user.onboarded_at is None and user.daily_target_words is not None:
        user.onboarded_at = now
    db.commit()
    return me_out(db, user, now, time_zone)


def remember_time_zone(db: Session, user: User, time_zone: ZoneInfo | None) -> None:
    """Keep the browser's zone: group boards count each member's days in it, and notifications
    come by its clock (ADR 0042). Only zones PostgreSQL knows are stored, so the board query can
    never fail on one. None (the browser sent none it could read) leaves what is there."""
    if time_zone is None or user.time_zone == time_zone.key:
        return
    known = db.scalar(
        text("SELECT count(*) FROM pg_timezone_names WHERE name = :zone"), {"zone": time_zone.key}
    )
    if known:
        user.time_zone = time_zone.key
        db.commit()
