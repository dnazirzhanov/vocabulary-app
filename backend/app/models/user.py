import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("daily_target_words BETWEEN 1 AND 100", name="daily_target_range"),
        CheckConstraint("study_days_per_week BETWEEN 1 AND 7", name="study_days_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Identity from the auth provider ("dev|<name>" in development). Never a client-supplied id.
    auth_subject: Mapped[str] = mapped_column(String(255), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Pace (ADR 0010). The target is a plan, not a cap; null until the learner has chosen one.
    daily_target_words: Mapped[int | None] = mapped_column(SmallInteger)
    study_days_per_week: Mapped[int] = mapped_column(SmallInteger, server_default=text("6"))
    ramp_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The learner's IANA zone as last sent by the browser: group boards count each member's days
    # in the member's own zone.
    time_zone: Mapped[str | None] = mapped_column(String(64))
    # The app's language, for its text and notifications (ADR 0055); null until it has one.
    ui_language: Mapped[str | None] = mapped_column(String(2))
    # Which notifications the learner wants (ADR 0042).
    notify_morning: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    notify_afternoon: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    notify_report: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    notify_deadline: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class DeletedLogin(Base):
    """A login whose account was just deleted (ADR 0043). Its tokens stay valid until they expire,
    so without this a phone still signed in would quietly create a new, unreachable account. Only
    the provider's opaque id; swept a day later."""

    __tablename__ = "deleted_logins"

    auth_subject: Mapped[str] = mapped_column(String(255), primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PaceDismissal(Base):
    """A pace suggestion the learner said no to; the same kind stays quiet for a week."""

    __tablename__ = "pace_dismissals"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    dismissed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DeckPace(Base):
    """New words a day in one deck (ADR 0028), and any extra words taken for one day. Course
    levels have no row: they share the learner's course pace (`users.daily_target_words`)."""

    __tablename__ = "deck_paces"
    __table_args__ = (
        CheckConstraint("daily_new BETWEEN 1 AND 100", name="daily_new_range"),
        CheckConstraint("extra_words BETWEEN 1 AND 200", name="extra_words_range"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    deck_id: Mapped[str] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), primary_key=True
    )
    daily_new: Mapped[int | None] = mapped_column(SmallInteger)
    # Extra new words for one local day only: tomorrow the plain pace applies again.
    extra_day: Mapped[date | None] = mapped_column(Date)
    extra_words: Mapped[int | None] = mapped_column(SmallInteger)


class PushSubscription(Base):
    """A browser or phone that agreed to notifications (ADR 0031, 0042): the push service's address
    for it and the keys to encrypt to it. No name, no e-mail; deleted with the learner, or when
    the push service says it is gone."""

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    endpoint: Mapped[str] = mapped_column(String(1024), unique=True)
    p256dh: Mapped[str] = mapped_column(String(128))
    auth: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # The learner's local day of the last reminder: at most one a day.
    # The local date of its last 17:00 notification, and of its last morning one (ADR 0042).
    last_sent_on: Mapped[date | None] = mapped_column(Date)
    last_morning_on: Mapped[date | None] = mapped_column(Date)


class PromiseChange(Base):
    """The weekdays a learner promises to study (ADR 0039), from a day on. The row in force for a
    day is the latest one starting on or before it, so a change never rewrites the past. Monday is
    bit 1, Sunday bit 64."""

    __tablename__ = "promise_changes"
    __table_args__ = (CheckConstraint("weekdays BETWEEN 1 AND 127", name="weekdays_range"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    effective_from: Mapped[date] = mapped_column(Date, primary_key=True)
    weekdays: Mapped[int] = mapped_column(SmallInteger)


class PromisePause(Base):
    """A learner's pause (holiday, illness): days from `from_date` to `until_date` are not
    promised, so they can't be missed. One at a time."""

    __tablename__ = "promise_pauses"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    from_date: Mapped[date] = mapped_column(Date)
    until_date: Mapped[date] = mapped_column(Date)
