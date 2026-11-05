import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Group(Base):
    """A friends' group (ADR 0011): joined by invite code, members appear only under a nickname."""

    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60))
    invite_code: Mapped[str] = mapped_column(String(8), unique=True)
    # The group's week (Monday to Sunday) is counted in this zone: the creator's at creation.
    time_zone: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id"),
        # "Ёжик" and "ёжик" are the same name to anyone reading the board.
        Index(
            "uq_group_members_group_id_nickname", "group_id", func.lower("nickname"), unique=True
        ),
        CheckConstraint("role IN ('owner', 'member')", name="role_values"),
    )

    # A separate id, so other members never see internal user ids.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    nickname: Mapped[str] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(8))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class GroupTest(Base):
    """A deck's spelling test in a group (ADR 0046). The words are drawn once, so everyone in the
    group is judged on the same ones; each attempt shuffles them for itself."""

    __tablename__ = "group_tests"
    __table_args__ = (
        CheckConstraint("pass_percent BETWEEN 1 AND 100", name="pass_percent_range"),
        CheckConstraint("minutes BETWEEN 1 AND 180", name="minutes_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deck_assignments.id", ondelete="CASCADE"), unique=True
    )
    word_ids: Mapped[list[str]] = mapped_column(JSONB)
    excluded_word_ids: Mapped[list[str]] = mapped_column(JSONB)
    # How many words were drawn at random; None: every word not excluded.
    question_count: Mapped[int | None] = mapped_column(SmallInteger)
    pass_percent: Mapped[int] = mapped_column(SmallInteger)
    minutes: Mapped[int] = mapped_column(SmallInteger)
    # Whether a timed attempt may start now. Practice needs only a saved test.
    is_open: Mapped[bool] = mapped_column(server_default=text("false"))


class GroupTestAttempt(Base):
    """One go at a test. A `test` is timed and happens once per member, which the database enforces
    however many tabs are open; `practice` is private and unlimited, one unfinished at a time."""

    __tablename__ = "test_attempts"
    __table_args__ = (
        CheckConstraint("kind IN ('test', 'practice')", name="kind_values"),
        Index(
            "uq_test_attempts_one_test",
            "test_id",
            "member_id",
            unique=True,
            postgresql_where=text("kind = 'test'"),
        ),
        Index(
            "uq_test_attempts_one_open_practice",
            "test_id",
            "member_id",
            unique=True,
            postgresql_where=text("kind = 'practice' AND finished_at IS NULL"),
        ),
        Index("ix_test_attempts_member_id", "member_id"),
        Index("ix_test_attempts_started_at", "started_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    test_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_tests.id", ondelete="CASCADE"))
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # When a timed attempt ends, whatever the device does. Practice has none.
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    correct: Mapped[int | None] = mapped_column(SmallInteger)
    total: Mapped[int | None] = mapped_column(SmallInteger)


class GroupTestQuestion(Base):
    """One word of an attempt, in the order that attempt shuffled, with what was answered. Its own
    copy of the word: the deck may change, or lose the word, while the attempt runs. A student only
    ever sees `key`, because a word's id can be the word itself (`house`)."""

    __tablename__ = "test_questions"

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("test_attempts.id", ondelete="CASCADE"), primary_key=True
    )
    word_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # What the web sends back: found among the attempt's few rows, so it needs no index of its own.
    key: Mapped[str] = mapped_column(String(12))
    position: Mapped[int] = mapped_column(SmallInteger)
    headword: Mapped[str] = mapped_column(String(64))
    translation: Mapped[str] = mapped_column(String(120))
    pos: Mapped[str] = mapped_column(String(16))
    # 1: skipped, and comes back after the other words. 2: skipped again, and that is final.
    skips: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    # All three stay null for a word skipped for good, or the time ran out on.
    answer: Mapped[str | None] = mapped_column(String(80))
    correct: Mapped[bool | None]
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
