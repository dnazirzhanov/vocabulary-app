"""Importing this package registers every table on Base.metadata (used by Alembic)."""

from app.models.content import (
    Deck,
    DeckAssignment,
    DeckSeenWord,
    DeckWord,
    GlossaryForm,
    Word,
)
from app.models.groups import Group, GroupMember
from app.models.learning import LearningSession, ReviewAttempt, UserWordProgress
from app.models.user import PaceDismissal, User

__all__ = [
    "Deck",
    "DeckAssignment",
    "DeckSeenWord",
    "DeckWord",
    "GlossaryForm",
    "Group",
    "GroupMember",
    "LearningSession",
    "PaceDismissal",
    "ReviewAttempt",
    "User",
    "UserWordProgress",
    "Word",
]
