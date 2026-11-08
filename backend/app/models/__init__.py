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
from app.models.groups import (
    Group,
    GroupMember,
    GroupTest,
    GroupTestAttempt,
    GroupTestQuestion,
)
from app.models.learning import (
    LearningSession,
    ReviewAttempt,
    SpellingProgress,
    StudyDayTotal,
    UserWordProgress,
)
from app.models.sync import SyncOp, SyncTombstone
from app.models.user import (
    DeckPace,
    DeletedLogin,
    PaceDismissal,
    PromiseChange,
    PromisePause,
    PushSubscription,
    User,
    WordingReport,
)

__all__ = [
    "Deck",
    "DeckAssignment",
    "DeckPace",
    "DeckSeenWord",
    "DeckTopic",
    "DeckWord",
    "DeletedLogin",
    "GlossaryForm",
    "Group",
    "GroupMember",
    "GroupTest",
    "GroupTestAttempt",
    "GroupTestQuestion",
    "LearningSession",
    "PaceDismissal",
    "PromiseChange",
    "PromisePause",
    "PushSubscription",
    "ReviewAttempt",
    "SpellingProgress",
    "StudyDayTotal",
    "SyncOp",
    "SyncTombstone",
    "User",
    "UserWordProgress",
    "Word",
    "WordingReport",
]
