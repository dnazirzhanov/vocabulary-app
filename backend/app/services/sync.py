"""Sync of personal decks and settings (ADR 0061), and of answers given on the device (ADR 0062,
`study_sync`).

A device changes its own decks, cards and settings without a connection and sends the changes
later as operations. Each operation is applied once: its id is recorded with its result in the
same transaction, so a retry (a lost answer, a closed app, a second tab) gets the same answer and
changes nothing. Edits name the values they were made against, so a change made elsewhere since is
reported as a conflict and never overwritten; fields nobody else touched are applied. Deletion wins
over an edit; a deleted deck or card is remembered 90 days (tombstones), and a device away longer
must pull everything again before its changes are taken.

The rules of the decks themselves (limits, duplicates, course words, deleting progress) are the
same functions the app's own routes use (`services/decks.py`).
"""

import logging
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import and_, delete, select, text
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Deck, DeckWord, SyncOp, SyncTombstone, User, Word
from app.schemas.decks import DeckWordIn
from app.schemas.sync import (
    CardCreate,
    CardDelete,
    CardReportOp,
    CardUpdate,
    DeckCreate,
    DeckDelete,
    DeckRename,
    Op,
    OpResult,
    PaceExtra,
    PullOut,
    PushIn,
    PushOut,
    SettingsChange,
    StudyAnswer,
    StudyFinish,
    SyncCardOut,
    SyncDeckOut,
)
from app.services import card_reports, decks, me, pace, study_sync
from app.services.scheduling import local_date
from app.services.study_days import zone_of

# How long deletions and applied operations are remembered (`cleanup`).
KEPT = timedelta(days=90)

logger = logging.getLogger("app.sync")


def _tombstone(db: Session, entity: str, entity_id: str) -> SyncTombstone | None:
    return db.get(SyncTombstone, (entity, entity_id))


def _mine(db: Session, user: User, deck_id: str) -> Deck | None:
    deck = db.get(Deck, deck_id)
    return deck if deck is not None and deck.kind == "user" and deck.owner_id == user.id else None


def _result(op: Op, status: str, **fields: Any) -> OpResult:
    return OpResult(op_id=op.op_id, status=status, **fields)


def _deck_or_status(db: Session, user: User, op: Op, deck_id: str) -> Deck | OpResult:
    """My deck, or what the device should hear instead: gone (deleted), or not mine."""
    deck = _mine(db, user, deck_id)
    if deck is not None:
        return deck
    if _tombstone(db, "deck", deck_id) is not None:
        return _result(op, "gone")
    return _result(op, "rejected", code="deck_not_found")


def _create_deck(db: Session, user: User, op: DeckCreate, now: datetime) -> OpResult:
    existing = db.get(Deck, op.deck_id)
    if existing is not None:
        mine = existing.kind == "user" and existing.owner_id == user.id
        # Never say whose it is: someone else's id looks like any taken one.
        return _result(op, "duplicate") if mine else _result(op, "rejected", code="id_taken")
    if _tombstone(db, "deck", op.deck_id) is not None:
        return _result(op, "gone")
    decks.new_deck(db, user, op.deck_id, op.title, op.language, now, op.reading_ref)
    return _result(op, "applied")


def _merge(
    current: dict[str, Any], wanted: dict[str, Any], base: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Three-way, per field: a field already as wanted needs nothing; one still as the device
    last saw it takes the device's value; one changed elsewhere meanwhile is a conflict, left as
    the server has it."""
    changes: dict[str, Any] = {}
    conflicts: dict[str, dict[str, Any]] = {}
    for field, value in wanted.items():
        if current[field] == value:
            continue
        if field in base and current[field] == base[field]:
            changes[field] = value
        else:
            conflicts[field] = {"mine": value, "server": current[field]}
    return changes, conflicts


def _rename(db: Session, user: User, op: DeckRename, now: datetime) -> OpResult:
    deck = _deck_or_status(db, user, op, op.deck_id)
    if isinstance(deck, OpResult):
        return deck
    changes, conflicts = _merge(
        {"title": deck.title}, {"title": op.title}, {"title": op.base_title}
    )
    if changes:
        decks.retitle(db, deck, op.title, now)
    if conflicts:
        return _result(op, "conflict", conflicts=conflicts)
    return _result(op, "applied" if changes else "duplicate")


def _delete_deck(db: Session, user: User, op: DeckDelete, now: datetime) -> OpResult:
    deck = _mine(db, user, op.deck_id)
    if deck is None:
        # Deleted already (by this op before, or another device): what was asked is so.
        gone = _tombstone(db, "deck", op.deck_id)
        if gone is not None and gone.owner_id == user.id:
            return _result(op, "duplicate")
        return _result(op, "rejected", code="deck_not_found")
    decks.drop_deck(db, deck, now)
    return _result(op, "applied")


def _in_deck(db: Session, deck: Deck, word_id: str) -> Word | None:
    return db.scalar(
        select(Word)
        .join(DeckWord, and_(DeckWord.word_id == Word.id, DeckWord.deck_id == deck.id))
        .where(Word.id == word_id)
    )


def _create_card(db: Session, user: User, op: CardCreate, now: datetime) -> OpResult:
    deck = _deck_or_status(db, user, op, op.deck_id)
    if isinstance(deck, OpResult):
        return deck
    if _tombstone(db, "word", op.word_id) is not None:
        return _result(op, "gone")
    existing = db.get(Word, op.word_id)
    if existing is not None:
        if existing.owner_deck_id == deck.id and _in_deck(db, deck, op.word_id) is not None:
            return _result(op, "duplicate")
        return _result(op, "rejected", code="id_taken")
    word = decks.add_card(db, deck, op.card, now, word_id=op.word_id)
    # A course word is linked, not copied: the device learns which word the card is.
    return _result(op, "applied", word_id=None if word.id == op.word_id else word.id)


def _update_card(db: Session, user: User, op: CardUpdate, now: datetime) -> OpResult:
    deck = _deck_or_status(db, user, op, op.deck_id)
    if isinstance(deck, OpResult):
        return deck
    word = _in_deck(db, deck, op.word_id)
    if word is None:
        # Deleted (here or on another device): deletion wins; bringing it back is a new card.
        return _result(op, "gone")
    wanted = op.fields.model_dump(exclude_unset=True, exclude_none=True)
    base = op.base.model_dump(exclude_unset=True)
    current = {field: getattr(word, field) for field in decks.EDITABLE}
    changes, conflicts = _merge(current, wanted, base)
    if changes:
        try:
            checked = DeckWordIn.model_validate({**current, **changes})
        except ValidationError as error:
            raise ApiError(422, "invalid_request", "The card is not valid") from error
        fields = checked.model_dump()
        decks.change_card(db, deck, word, {field: fields[field] for field in changes}, now)
    if conflicts:
        return _result(op, "conflict", conflicts=conflicts)
    return _result(op, "applied" if changes else "duplicate")


def _delete_card(db: Session, user: User, op: CardDelete, now: datetime) -> OpResult:
    deck = _deck_or_status(db, user, op, op.deck_id)
    if isinstance(deck, OpResult):
        return deck
    word = _in_deck(db, deck, op.word_id)
    if word is None:
        return _result(op, "duplicate")  # out already: what was asked is so
    decks.take_out(db, deck, word, now)
    return _result(op, "applied")


def _change_settings(
    db: Session, user: User, op: SettingsChange, now: datetime, time_zone: ZoneInfo
) -> OpResult:
    if op.fields.study_days_per_week is not None:
        raise ApiError(422, "online_only", "The promise is changed online")
    wanted = op.fields.model_dump(exclude_unset=True, exclude_none=True)
    current = {field: getattr(user, field) for field in wanted}
    changes, conflicts = _merge(current, wanted, op.base.model_dump(exclude_unset=True))
    if changes:
        me.apply_changes(db, user, op.fields.model_validate(changes), now, time_zone)
    if conflicts:
        return _result(op, "conflict", conflicts=conflicts)
    return _result(op, "applied" if changes else "duplicate")


def _extra_words(db: Session, user: User, op: PaceExtra, now: datetime) -> OpResult:
    """«Ещё N слов» pressed on the device: on the learner's day it was pressed (a clock ahead of
    the server's counts as now)."""
    deck = decks.visible_deck(db, user, op.deck_id)
    day = local_date(min(op.added_at, now), zone_of(user))
    pace.extend(db, user, deck, op.words, day)
    return _result(op, "applied")


def _apply(db: Session, user: User, op: Op, now: datetime, time_zone: ZoneInfo) -> OpResult:
    if isinstance(op, DeckCreate):
        return _create_deck(db, user, op, now)
    if isinstance(op, DeckRename):
        return _rename(db, user, op, now)
    if isinstance(op, DeckDelete):
        return _delete_deck(db, user, op, now)
    if isinstance(op, CardCreate):
        return _create_card(db, user, op, now)
    if isinstance(op, CardUpdate):
        return _update_card(db, user, op, now)
    if isinstance(op, CardDelete):
        return _delete_card(db, user, op, now)
    if isinstance(op, CardReportOp):
        card_reports.report(
            db, user, op.deck_id, op.word_id, op.reason, op.note, min(op.reported_at, now)
        )
        return _result(op, "applied")
    if isinstance(op, PaceExtra):
        return _extra_words(db, user, op, now)
    if isinstance(op, StudyAnswer):
        return study_sync.apply_answer(db, user, op, now)
    if isinstance(op, StudyFinish):
        return study_sync.apply_finish(db, user, op, now)
    return _change_settings(db, user, op, now, time_zone)


def push(db: Session, user: User, body: PushIn, now: datetime, time_zone: ZoneInfo) -> PushOut:
    """Applies a device's operations in order, each in its own transaction with its record."""
    if body.pulled_at is None or now - body.pulled_at > KEPT:
        raise ApiError(409, "resync_required", "Pull everything again before sending changes")
    results: list[OpResult] = []
    for op in body.ops:
        done = db.get(SyncOp, (user.id, op.op_id))
        if done is not None:
            results.append(OpResult.model_validate(done.result))
            continue
        try:
            with db.begin_nested():
                result = _apply(db, user, op, now, time_zone)
        except ApiError as error:
            result = _result(op, "rejected", code=error.code)
        except Exception:
            # A fault of ours in one operation: logged with its trace, and refused, so it can't
            # fail every push and hold back all of this device's later changes for good.
            logger.exception("sync operation failed: %s", op.kind)
            result = _result(op, "rejected", code="server_error")
        db.add(
            SyncOp(
                user_id=user.id,
                op_id=op.op_id,
                result=result.model_dump(mode="json"),
                applied_at=now,
            )
        )
        db.commit()
        results.append(result)
    return PushOut(results=results)


def _deck_out(db: Session, deck: Deck) -> SyncDeckOut:
    rows = db.execute(
        select(Word, DeckWord.position)
        .join(DeckWord, DeckWord.word_id == Word.id)
        .where(DeckWord.deck_id == deck.id)
        .order_by(DeckWord.position)
    ).all()
    return SyncDeckOut(
        id=deck.id,
        title=deck.title,
        language=deck.explanation_language,
        status=deck.status,
        version=deck.version,
        created_at=deck.created_at,
        reading_ref=deck.reading_ref,
        cards=[
            SyncCardOut(
                id=word.id,
                headword=word.headword,
                pos=word.pos,
                translation=word.translation,
                example=word.example,
                example_translation=word.example_translation,
                language=word.language,
                version=word.version,
                position=position,
                from_course=word.owner_deck_id != deck.id,
            )
            for word, position in rows
        ],
    )


def pull(
    db: Session, user: User, cursor: int, pulled_at: datetime | None, now: datetime
) -> PullOut:
    """My decks changed since `cursor`, and the ones deleted. Everything when the device has
    nothing yet, or was away longer than deletions are remembered."""
    # Waits for any change of mine still being written, so none can slip under the cursor.
    decks.lock_owner(db, user.id)
    # Every number up to this one is taken, and with the lock held every change of mine among
    # them is committed: the next pull starts after it.
    last = int(db.scalar(text("SELECT last_value FROM sync_change_seq")) or 0)
    full = cursor == 0 or pulled_at is None or now - pulled_at > KEPT
    query = select(Deck).where(Deck.kind == "user", Deck.owner_id == user.id)
    if not full:
        query = query.where(Deck.change_seq > cursor)
    changed = list(db.scalars(query.order_by(Deck.created_at, Deck.id)))
    deleted = (
        []
        if full
        else list(
            db.scalars(
                select(SyncTombstone.entity_id).where(
                    SyncTombstone.owner_id == user.id,
                    SyncTombstone.entity == "deck",
                    SyncTombstone.change_seq > cursor,
                )
            )
        )
    )
    out = PullOut(
        cursor=max(last, cursor),
        full=full,
        decks=[_deck_out(db, deck) for deck in changed],
        deleted_decks=deleted,
        pulled_at=now,
    )
    db.commit()  # releases the lock
    return out


def forget_old(db: Session, now: datetime) -> int:
    """Deletions and applied operations older than the window; devices away longer resync."""
    gone = db.execute(delete(SyncTombstone).where(SyncTombstone.deleted_at < now - KEPT))
    ops = db.execute(delete(SyncOp).where(SyncOp.applied_at < now - KEPT))
    db.commit()
    return int(getattr(gone, "rowcount", 0) or 0) + int(getattr(ops, "rowcount", 0) or 0)
