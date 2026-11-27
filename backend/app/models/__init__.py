"""Importing this package registers every table on Base.metadata (used by Alembic)."""

from app.models.client_error import ClientError
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
    LearnerFact,
    MentorAdjustment,
    MentorConversation,
    MentorEvent,
    MentorGoal,
    MentorMessage,
    MentorTimelineEvent,
)
from app.models.prompt_glossary import PromptGlossary
from app.models.reading import (
    Reading,
    ReadingAnswer,
    ReadingAssignment,
    ReadingCategory,
    ReadingQuestion,
)
from app.models.schedule import MentorDayOverride, MentorDayType, ScheduleEvent, ScheduleSkip
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
from app.models.tasks import Task, TaskMark
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
from app.models.youtube_transcript import YouTubeTranscript

__all__ = [
    "CardReport",
    "ClientError",
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
    "LearnerFact",
    "LearningSession",
    "MentorAdjustment",
    "MentorConversation",
    "MentorDayOverride",
    "MentorDayType",
    "MentorEvent",
    "MentorGoal",
    "MentorMessage",
    "MentorTimelineEvent",
    "PaceDismissal",
    "PromiseChange",
    "PromisePause",
    "PromptGlossary",
    "PronunciationAudio",
    "PushSubscription",
    "Reading",
    "ReadingAnswer",
    "ReadingAssignment",
    "ReadingCategory",
    "ReadingQuestion",
    "ReviewAttempt",
    "ScheduleEvent",
    "ScheduleSkip",
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
    "Task",
    "TaskMark",
    "User",
    "UserWordProgress",
    "Word",
    "WordingReport",
    "WritingSubmission",
    "YouTubeTranscript",
]
