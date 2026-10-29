"""Teachers' decks: write, publish, give to a group and take back (ADR 0017)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request, Response

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now, TimeZone
from app.core.config import Settings, get_settings
from app.core.ratelimit import limit_generations
from app.schemas.decks import (
    DeckWordIn,
    FillIn,
    GenerateIn,
    GenerateOut,
    LibraryOut,
    NewDeckIn,
    PublishIn,
    RenameDeckIn,
    SuggestIn,
    SuggestOut,
    TeacherDeckOut,
    TopicIn,
)
from app.services import decks, sessions
from app.services.generation import DemoProvider, Provider, provider_for

router = APIRouter(tags=["decks"])
DeckId = Annotated[str, Path(max_length=64)]
WordId = Annotated[str, Path(max_length=64)]


@router.get("/decks/mine")
def my_decks(user: CurrentUser, db: DbSession) -> list[TeacherDeckOut]:
    return decks.my_decks(db, user)


@router.post("/decks", status_code=201)
def create_deck(body: NewDeckIn, user: CurrentUser, db: DbSession, now: Now) -> TeacherDeckOut:
    return decks.create_deck(db, user, body, now)


@router.get("/decks/{deck_id}/edit")
def get_deck(deck_id: DeckId, user: CurrentUser, db: DbSession) -> TeacherDeckOut:
    """The deck as its author edits it (anyone else: 404)."""
    return decks.get_deck(db, user, deck_id)


@router.patch("/decks/{deck_id}")
def rename_deck(
    deck_id: DeckId, body: RenameDeckIn, user: CurrentUser, db: DbSession
) -> TeacherDeckOut:
    return decks.rename(db, user, deck_id, body.title)


@router.delete("/decks/{deck_id}", status_code=204)
def delete_deck(deck_id: DeckId, user: CurrentUser, db: DbSession) -> Response:
    """My deck, for good: its own cards, everyone's progress on them, its lessons (ADR 0019)."""
    decks.delete_deck(db, user, deck_id)
    return Response(status_code=204)


@router.post("/decks/{deck_id}/words", status_code=201)
def add_word(deck_id: DeckId, body: DeckWordIn, user: CurrentUser, db: DbSession) -> TeacherDeckOut:
    return decks.add_word(db, user, deck_id, body)


DEV_GENERATION_HEADER = "X-Dev-Generation"


def get_provider(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Provider:
    # Browser tests reuse a developer's running server, which may hold a real key: they ask for
    # the demo. Like X-Dev-Now, only in dev auth mode, which cannot run in production.
    if settings.auth_mode == "dev" and request.headers.get(DEV_GENERATION_HEADER) == "demo":
        return DemoProvider()
    return provider_for(settings)


@router.post("/decks/{deck_id}/generate", dependencies=[Depends(limit_generations)])
def generate(
    deck_id: DeckId,
    body: GenerateIn,
    user: CurrentUser,
    db: DbSession,
    provider: Annotated[Provider, Depends(get_provider)],
) -> GenerateOut:
    """Draft cards from the teacher's text into the deck (ADR 0018); the text is not stored."""
    return decks.generate(db, user, deck_id, body, provider)


@router.get("/decks/library")
def library(user: CurrentUser, db: DbSession, now: Now, time_zone: TimeZone) -> LibraryOut:
    """«Мои колоды»: decks I wrote and decks given to my groups (ADR 0019)."""
    return sessions.library(db, user, now, time_zone)


@router.post("/decks/{deck_id}/words/fill", dependencies=[Depends(limit_generations)])
def fill(
    deck_id: DeckId,
    body: FillIn,
    user: CurrentUser,
    db: DbSession,
    provider: Annotated[Provider, Depends(get_provider)],
) -> GenerateOut:
    """Full cards from the words I name, saved to the deck (ADR 0019)."""
    return decks.fill(db, user, deck_id, body, provider)


@router.post("/decks/{deck_id}/words/topic", dependencies=[Depends(limit_generations)])
def topic(
    deck_id: DeckId,
    body: TopicIn,
    user: CurrentUser,
    db: DbSession,
    provider: Annotated[Provider, Depends(get_provider)],
) -> GenerateOut:
    """Cards for a topic, saved to the deck (ADR 0019)."""
    return decks.topic(db, user, deck_id, body, provider)


@router.post("/decks/{deck_id}/words/suggest", dependencies=[Depends(limit_generations)])
def suggest(
    deck_id: DeckId,
    body: SuggestIn,
    user: CurrentUser,
    db: DbSession,
    provider: Annotated[Provider, Depends(get_provider)],
) -> SuggestOut:
    """One card filled in for the manual form; not saved."""
    return decks.suggest(db, user, deck_id, body, provider)


@router.put("/decks/{deck_id}/words/{word_id}")
def edit_word(
    deck_id: DeckId, word_id: WordId, body: DeckWordIn, user: CurrentUser, db: DbSession
) -> TeacherDeckOut:
    return decks.edit_word(db, user, deck_id, word_id, body)


@router.delete("/decks/{deck_id}/words/{word_id}")
def remove_word(
    deck_id: DeckId, word_id: WordId, user: CurrentUser, db: DbSession
) -> TeacherDeckOut:
    return decks.remove_word(db, user, deck_id, word_id)


@router.post("/decks/{deck_id}/publish")
def publish(
    deck_id: DeckId, body: PublishIn, user: CurrentUser, db: DbSession, now: Now
) -> TeacherDeckOut:
    """Publish and give to a group I own; idempotent."""
    return decks.publish(db, user, deck_id, body.group_id, now)


@router.delete("/groups/{group_id}/decks/{deck_id}", status_code=204)
def take_back(
    group_id: UUID, deck_id: DeckId, user: CurrentUser, db: DbSession, now: Now
) -> Response:
    decks.take_back(db, user, group_id, deck_id, now)
    return Response(status_code=204)
