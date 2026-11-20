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
from app.models.mentor import (
    MentorAdjustment,
    MentorConversation,
    MentorGoal,
    MentorMessage,
)
from app.models.reading import (
    Reading,
    ReadingAnswer,
    ReadingAssignment,
    ReadingCategory,
    ReadingQuestion,
)
from app.models.schedule import ScheduleEvent
from app.models.shadowing import ShadowingAttempt, ShadowingExercise
from app.models.speaking import (
    SpeakingAssessment,
    SpeakingAudioAsset,
    SpeakingFeedbackItem,
    SpeakingJob,
    SpeakingSession,
)
from app.models.speech import PronunciationAudio
from app.models.sync import SyncDevice, SyncOp, SyncTombstone
from app.models.user import (
    CardReport,
    DeckPace,
    DeletedLogin,
    PaceDismissal,
    PromiseChange,
    PromisePause,
    PushSubscription,
    User,
    WordingReport,
)
from app.models.writing import WritingSubmission

__all__ = [
    "CardReport",
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
    "MentorAdjustment",
    "MentorConversation",
    "MentorGoal",
    "MentorMessage",
    "PaceDismissal",
    "PromiseChange",
    "PromisePause",
    "PronunciationAudio",
    "PushSubscription",
    "Reading",
    "ReadingAnswer",
    "ReadingAssignment",
    "ReadingCategory",
    "ReadingQuestion",
    "ReviewAttempt",
    "ScheduleEvent",
    "ShadowingAttempt",
    "ShadowingExercise",
    "SpeakingAssessment",
    "SpeakingAudioAsset",
    "SpeakingFeedbackItem",
    "SpeakingJob",
    "SpeakingSession",
    "SpellingProgress",
    "StudyDayTotal",
    "SyncDevice",
    "SyncOp",
    "SyncTombstone",
    "User",
    "UserWordProgress",
    "Word",
    "WordingReport",
    "WritingSubmission",
]
