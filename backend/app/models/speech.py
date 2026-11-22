"""Pronunciation audio made once by the server's voice and kept (ADR 0070)."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PronunciationAudio(Base):
    """One spoken word or example, in one voice. Shared by everyone: the same text always plays the
    same file. Keyed by a hash of voice, kind and text."""

    __tablename__ = "pronunciation_audio"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    voice: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    storage_path: Mapped[str] = mapped_column(String(255))
    byte_size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
