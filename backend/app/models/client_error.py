"""An error the app showed a learner as «Что-то пошло не так» (ADR 0094): what failed, kept so a
problem on one device can be found. Never the learner's words or answers: where, the error's name
and message, the top of its stack, and the app's build."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ClientError(Base):
    __tablename__ = "client_errors"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    place: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(80))
    message: Mapped[str] = mapped_column(Text)
    stack: Mapped[str] = mapped_column(Text)
    build: Mapped[str] = mapped_column(String(80))
    agent: Mapped[str] = mapped_column(String(200))
