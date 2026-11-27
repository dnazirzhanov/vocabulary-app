"""A YouTube video's English captions as fetched by the server (ADR 0100), kept so each video is
fetched once for everyone. A failed fetch is kept too, for an hour, so nobody hammers YouTube."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class YouTubeTranscript(Base):
    __tablename__ = "youtube_transcripts"

    youtube_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    # 'manual' (the channel's own subtitles), 'auto' (YouTube's speech recognition), or 'none'.
    kind: Mapped[str] = mapped_column(String(8))
    # [{start_ms, end_ms, text}], in order; empty when kind is 'none'.
    cues: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    # With the channel's own lines: YouTube's speech recognition, a word to a cue, for their times.
    words: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
