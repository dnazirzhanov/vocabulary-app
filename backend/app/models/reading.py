"""Texts people add to Reading Mode themselves, and the categories they keep them in.

The library's own articles are static files (content/reading/); these live here, one owner each,
private until given to a group (round 2, R2-D).
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ReadingCategory(Base):
    """A name a person files their own texts under («Мои категории»)."""

    __tablename__ = "reading_categories"
    __table_args__ = (
        Index("uq_reading_categories_name", "owner_id", func.lower("name"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Reading(Base):
    """A text someone added: its paragraphs and, once drafted, every word's meaning."""

    __tablename__ = "readings"
    __table_args__ = (CheckConstraint("status IN ('drafting', 'ready', 'failed')", name="status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Deleting a category keeps its texts, outside any category.
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reading_categories.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(120))
    # Paragraphs, in order.
    body: Mapped[list[str]] = mapped_column(JSONB)
    words: Mapped[int] = mapped_column(Integer)
    # The language its meanings are written in: the owner's card language when it was added.
    language: Mapped[str] = mapped_column(String(2))
    level: Mapped[str | None] = mapped_column(String(2))
    # Every word form → {l: lemma, p: part of speech or null, t: meaning, d: explanation or null},
    # the static articles' shape with the meaning under `t`. Empty while drafting.
    glossary: Mapped[dict[str, dict[str, str | None]]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
