"""A question prompt's meanings (ADR 0091): each word of a Writing or Speaking question, glossed
once per card language and kept, so a tap on a word shows its translation as Reading does."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PromptGlossary(Base):
    __tablename__ = "prompt_glossaries"

    # 'writing' or 'speaking', the question's id, and the language its meanings are in.
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    question_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    language: Mapped[str] = mapped_column(String(8), primary_key=True)
    # The text it was made for: a question reworded is glossed again.
    text: Mapped[str] = mapped_column(Text)
    # form → {l: lemma, p: part of speech, t: meaning, d: explanation}, as a reading's glossary.
    glossary: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
