"""Importing this package registers every table on Base.metadata (used by Alembic)."""

from app.models.content import (
    Deck,
    DeckAssignment,
    DeckSeenWord,
    DeckTopic,
    DeckWord,
    GlossaryForm,
    Word,
)
from app.models.groups import Group, GroupMember
from app.models.learning import (
    LearningSession,
    ReviewAttempt,
    SpellingProgress,
    UserWordProgress,
)
from app.models.user import DeckPace, PaceDismissal, PushSubscription, User

__all__ = [
    "Deck",
    "DeckAssignment",
    "DeckPace",
    "DeckSeenWord",
    "DeckTopic",
    "DeckWord",
    "GlossaryForm",
    "Group",
    "GroupMember",
    "LearningSession",
    "PaceDismissal",
    "PushSubscription",
    "ReviewAttempt",
    "SpellingProgress",
    "User",
    "UserWordProgress",
    "Word",
]
