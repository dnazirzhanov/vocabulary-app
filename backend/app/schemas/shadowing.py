"""API contracts for the Shadowing feature."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints


class SentenceOut(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class ExerciseOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    description: str
    difficulty: str
    language: str
    duration_ms: int
    transcript: str
    sentences: list[SentenceOut]
    speaker: str | None
    has_audio: bool
    display_order: int
    # ADR 0097: a YouTube exercise plays in YouTube's player; its sentences' times are the video's.
    source: Literal["file", "youtube"] = "file"
    youtube_id: str | None = None
    clip_start_ms: int | None = None
    clip_end_ms: int | None = None
    thumbnail_url: str | None = None
    mine: bool = False


Difficulty = Literal["beginner", "intermediate", "advanced"]
SentenceText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)
]
ExerciseTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
Ms = Annotated[int, Field(ge=0, le=24 * 60 * 60 * 1000)]
Sentences = Annotated[list["SentenceIn"], Field(min_length=1, max_length=200)]


class YouTubeCheckIn(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class YouTubeVideoOut(BaseModel):
    youtube_id: str
    title: str
    author: str
    thumbnail_url: str


class YouTubeTranscriptIn(BaseModel):
    youtube_id: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16)
    ]


class CueOut(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class YouTubeTranscriptOut(BaseModel):
    # 'manual': the channel's own subtitles; 'auto': YouTube's speech recognition.
    kind: Literal["manual", "auto"]
    cues: list[CueOut]


class SentenceIn(BaseModel):
    start_ms: Ms
    end_ms: Ms
    text: SentenceText


class ExerciseIn(BaseModel):
    youtube_id: Annotated[str, StringConstraints(min_length=11, max_length=11)]
    title: ExerciseTitle
    author: Annotated[str, StringConstraints(max_length=128)] = ""
    difficulty: Difficulty = "beginner"
    clip_start_ms: Ms
    clip_end_ms: Ms
    sentences: Sentences


class ExercisePatch(BaseModel):
    title: ExerciseTitle | None = None
    difficulty: Difficulty | None = None
    clip_start_ms: Ms | None = None
    clip_end_ms: Ms | None = None
    sentences: Sentences | None = None


class CreateAttemptIn(BaseModel):
    exercise_id: uuid.UUID


class AttemptOut(BaseModel):
    id: uuid.UUID
    exercise_id: uuid.UUID
    duration_ms: int | None
    completed_at: datetime | None
    created_at: datetime


class ExerciseStatusOut(BaseModel):
    exercise_id: uuid.UUID
    attempts_count: int
    completed_count: int
    last_attempted_at: datetime | None


class AttemptListItem(BaseModel):
    id: uuid.UUID
    duration_ms: int | None
    completed_at: datetime | None
    created_at: datetime
    has_audio: bool
