"""Importing this package registers every table on Base.metadata (used by Alembic)."""

from app.models.content import Deck, DeckWord, Word
from app.models.learning import LearningSession, ReviewAttempt, UserWordProgress
from app.models.user import PaceDismissal, User

__all__ = [
    "Deck",
    "DeckWord",
    "LearningSession",
    "PaceDismissal",
    "ReviewAttempt",
    "User",
    "UserWordProgress",
    "Word",
]
