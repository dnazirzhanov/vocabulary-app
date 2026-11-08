"""Sync of personal decks (ADR 0061): what was deleted, and which operations were applied; and the
devices that study (ADR 0062)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SyncTombstone(Base):
    """A deck or card that was deleted, so a device that still has it drops it, and an id once
    used is never used again. Kept 90 days (`cleanup`); a device away longer pulls everything."""

    __tablename__ = "sync_tombstones"
    __table_args__ = (
        CheckConstraint("entity IN ('deck', 'word')", name="entity"),
        Index("ix_sync_tombstones_owner_id_change_seq", "owner_id", "change_seq"),
    )

    entity: Mapped[str] = mapped_column(String(8), primary_key=True)
    entity_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # A card's deck, so the card can be dropped from it.
    deck_id: Mapped[str | None] = mapped_column(String(64))
    change_seq: Mapped[int] = mapped_column(
        BigInteger, server_default=text("nextval('sync_change_seq')")
    )
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class SyncOp(Base):
    """An operation a device sent, with what came of it: sent again (a retry, a lost answer), it
    gets the same answer and nothing happens twice. Kept 90 days."""

    __tablename__ = "sync_ops"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    op_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class SyncDevice(Base):
    """A device that studies offline (ADR 0062), and when the server last saw it: answers it sends
    may not be dated before that, so days the server has seen can't be filled in afterwards."""

    __tablename__ = "sync_devices"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    last_contact_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
