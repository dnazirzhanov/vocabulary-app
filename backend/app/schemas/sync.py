"""Sync of personal decks and settings (ADR 0061) and of studying on the device (ADR 0062): what a
device sends, and what it gets back."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.card_reports import Note, ReportReason
from app.schemas.decks import DeckWordIn, ReadingRef, Title
from app.schemas.learning import RatingResponse, SpellingResponse
from app.schemas.me import CardLanguage, MeUpdate, UiLanguage

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
# Ids a device makes for what it creates: never guessable, never another's (checked on the server).
NewDeckId = Annotated[str, StringConstraints(pattern=rf"^g-{_UUID}$")]
NewWordId = Annotated[str, StringConstraints(pattern=rf"^t-{_UUID}$")]
# Any existing deck or card: older ones have shorter ids, course words their slug.
AnyId = Annotated[str, StringConstraints(min_length=1, max_length=64)]
Short = Annotated[str, StringConstraints(max_length=300)]


class _Op(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Made by the device once and sent with every retry: the same answer, nothing done twice.
    op_id: UUID


class DeckCreate(_Op):
    kind: Literal["deck.create"]
    deck_id: NewDeckId
    title: Title
    language: CardLanguage | None = None
    # A deck made from a reading (Reading Mode); set once, when made.
    reading_ref: ReadingRef | None = None


class DeckRename(_Op):
    kind: Literal["deck.rename"]
    deck_id: AnyId
    title: Title
    # The title the device had when it was changed there: anything else on the server is
    # someone else's change, never overwritten.
    base_title: Short


class DeckDelete(_Op):
    kind: Literal["deck.delete"]
    deck_id: AnyId


class CardCreate(_Op):
    kind: Literal["card.create"]
    deck_id: AnyId
    word_id: NewWordId
    card: DeckWordIn


class CardFields(BaseModel):
    """The fields changed, each optional; checked whole once merged with the rest of the card."""

    model_config = ConfigDict(extra="forbid")

    headword: Short | None = None
    pos: Short | None = None
    translation: Short | None = None
    example: Short | None = None
    example_translation: Short | None = None
    language: CardLanguage | None = None


class CardUpdate(_Op):
    kind: Literal["card.update"]
    deck_id: AnyId
    word_id: AnyId
    fields: CardFields
    # Each changed field as the device had it before the change.
    base: CardFields


class CardDelete(_Op):
    kind: Literal["card.delete"]
    deck_id: AnyId
    word_id: AnyId


class SettingsBase(BaseModel):
    """Settings as the device had them before the change (any of them)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    ui_language: UiLanguage | None = None
    language: CardLanguage | None = None
    daily_target_words: int | None = None
    ramp_enabled: bool | None = None
    notify_morning: bool | None = None
    notify_afternoon: bool | None = None
    notify_report: bool | None = None
    notify_deadline: bool | None = None


class SettingsChange(_Op):
    kind: Literal["me.update"]
    # The promise and its pause stay online only: "from tomorrow" is the server's day (ADR 0039).
    fields: MeUpdate
    base: SettingsBase


class CardReportOp(_Op):
    """A card said to be wrong, from a lesson or the deck's word list (works offline too)."""

    kind: Literal["card.report"]
    deck_id: AnyId
    word_id: AnyId
    reason: ReportReason
    note: Note | None = None
    reported_at: datetime


class PaceExtra(_Op):
    """«Ещё N слов» (ADR 0028), pressed on the device: more new words in a deck on that day."""

    kind: Literal["pace.extra"]
    deck_id: AnyId
    words: Annotated[int, Field(ge=1, le=100)]
    # When it was pressed (server's clock, as answers): the learner's day it adds to.
    added_at: datetime


class ReadingAnswerOp(_Op):
    """An answer to a comprehension question (Reading Mode, round 2), written on the device."""

    kind: Literal["reading.answer"]
    question_ref: Annotated[str, StringConstraints(max_length=80)]
    text: Annotated[str, StringConstraints(max_length=10_000)]
    # When it was written: an older edit arriving after a newer one is kept out.
    answered_at: datetime


class StudyAnswer(_Op):
    """One answer in a lesson planned on the device (ADR 0062): re-applied by the server with the
    same rules, at the moment it was given. The first answer of a session creates it."""

    kind: Literal["study.answer"]
    # The device that studied: its answers may not be dated before its last contact.
    device_id: UUID
    session_id: UUID
    session_kind: Literal["study", "hard", "spelling"]
    deck_id: AnyId
    # As the device planned it (c1, c2… for cards, s1… for spelling; a card shown again gets the
    # next number): unique within the session.
    exercise_id: Annotated[str, StringConstraints(pattern=r"^[cs][0-9]{1,6}$")]
    word_id: AnyId
    # The word's first showing ever: it is introduced, not recalled.
    new: bool = False
    # Spelling: the slot whose letter was given as a hint, if one was.
    hint: Annotated[int, Field(ge=0, le=63)] | None = None
    response: Annotated[RatingResponse | SpellingResponse, Field(discriminator="kind")]
    # On the server's clock (the device corrects its own by the offset it last measured).
    answered_at: datetime


class StudyFinish(_Op):
    """The end of a device's lesson: finished, or left for another one (set aside)."""

    kind: Literal["study.finish"]
    device_id: UUID
    session_id: UUID
    set_aside: bool = False
    finished_at: datetime


Op = Annotated[
    DeckCreate
    | DeckRename
    | DeckDelete
    | CardCreate
    | CardUpdate
    | CardDelete
    | SettingsChange
    | PaceExtra
    | CardReportOp
    | ReadingAnswerOp
    | StudyAnswer
    | StudyFinish,
    Field(discriminator="kind"),
]
MAX_OPS = 200


class PushIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ops: Annotated[list[Op], Field(min_length=1, max_length=MAX_OPS)]
    # When this device last pulled: past the tombstone window (90 days) it must pull everything
    # again before its changes are accepted.
    pulled_at: datetime | None


Status = Literal["applied", "duplicate", "conflict", "gone", "rejected"]


class OpResult(BaseModel):
    op_id: UUID
    status: Status
    # rejected: why (the API's error code, e.g. word_in_deck, deck_full, invalid_name).
    code: str | None = None
    # conflict: each field changed elsewhere since the device's copy, with both values; the
    # other fields of the op were applied.
    conflicts: dict[str, dict[str, Any]] | None = None
    # card.create: the word the card is, when it differs from the device's id (a course word,
    # linked rather than copied, ADR 0019).
    word_id: str | None = None


class PushOut(BaseModel):
    results: list[OpResult]


class SyncCardOut(BaseModel):
    id: str
    headword: str
    pos: str
    translation: str
    example: str
    example_translation: str
    language: str
    version: int
    position: int
    from_course: bool


class SyncDeckOut(BaseModel):
    id: str
    title: str
    language: str
    status: str
    version: int
    created_at: datetime
    reading_ref: str | None = None
    cards: list[SyncCardOut]


class PullOut(BaseModel):
    # Send it back next time: only what changed after it comes.
    cursor: int
    # Every deck of mine, not only the changed ones: the device replaces what it has.
    full: bool
    decks: list[SyncDeckOut]
    deleted_decks: list[str]
    pulled_at: datetime
