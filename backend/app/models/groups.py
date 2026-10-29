import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, func
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
