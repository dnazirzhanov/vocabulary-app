"""Studying on the device (ADR 0062): the pack a device studies from, and its answers re-applied.

The device plans a lesson, schedules each card and checks each spelling itself, with a copy of the
rules (web/src/study/). Its answers arrive later through sync (ADR 0061), each with the moment it
was given, and are applied here by the same functions the per-card routes use, at that moment: the
server's result is the one that counts, and the next pack brings it to the device.

A device's lesson is made from its answers: the first one creates it (origin 'device'), each one
adds its exercise to the plan, and `study.finish` closes it.

Late answers count for the day they were given (owner's decision), within a guard: no later than a
few minutes ahead of the server, no older than 30 days, and never before this device's last
contact with the server, so days the server has already seen can't be filled in afterwards.
"""

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    Deck,
    DeckPace,
    DeckWord,
    LearningSession,
    ReviewAttempt,
    SpellingProgress,
    SyncDevice,
    User,
    UserWordProgress,
    Word,
)
from app.schemas.learning import SpellingResponse
from app.schemas.study import (
    DeckKind,
    PackDeck,
    PackIntroduced,
    PackPace,
    PackWord,
    StudyPackOut,
)
from app.schemas.sync import OpResult, StudyAnswer, StudyFinish
from app.services import decks, me, pace, sessions
from app.services.learning import PlannedExercise
from app.services.progress import INTRODUCTION, local_day_bounds
from app.services.scheduling import local_date
from app.services.study_days import zone_of

# An answer may be dated a little ahead of the server: the device's correction is measured over
# the network, so it can be off by a moment.
AHEAD = timedelta(minutes=5)
# Older answers are refused: lessons are cleaned up after 35 days (ADR 0044), and a month is
# longer than anyone studies without a connection.
OLDEST = timedelta(days=30)
# A device's last contact is the moment its pack was sent. An answer given just before it (in
# another tab of the same device, say, while the pack was on its way) is let through.
CONTACT_SLACK = timedelta(minutes=5)


# --- the guard ------------------------------------------------------------------------------


def touch(db: Session, user: User, device_id: UUID, now: datetime) -> None:
    """The server has seen this device now; the caller commits."""
    db.execute(
        insert(SyncDevice)
        .values(user_id=user.id, device_id=device_id, last_contact_at=now)
        .on_conflict_do_update(
            index_elements=[SyncDevice.user_id, SyncDevice.device_id],
            set_={"last_contact_at": func.greatest(SyncDevice.last_contact_at, now)},
        )
    )


def refusal(
    db: Session, user: User, device_id: UUID, moment: datetime, now: datetime
) -> str | None:
    """Why an answer dated `moment` can't be taken from this device, or None."""
    if moment > now + AHEAD:
        return "in_future"
    if moment < now - OLDEST:
        return "too_old"
    device = db.get(SyncDevice, (user.id, device_id))
    if device is None:
        # A device studies from a pack, and fetching one is its first contact.
        return "unknown_device"
    if moment < device.last_contact_at - CONTACT_SLACK:
        return "before_last_contact"
    return None


# --- answers --------------------------------------------------------------------------------


def _rejected(op: StudyAnswer | StudyFinish, code: str) -> OpResult:
    return OpResult(op_id=op.op_id, status="rejected", code=code)


def _session_for(db: Session, user: User, op: StudyAnswer) -> LearningSession | OpResult | None:
    """The device's lesson this answer belongs to; None when this is its first answer (the lesson
    is then made from a deck I may study). Later answers stand even if the deck is no longer mine
    to study (I left the group): they were given while it was, as an open lesson's are online."""
    session = db.get(LearningSession, op.session_id)
    if session is None:
        decks.visible_deck(db, user, op.deck_id)
        return None
    if session.user_id != user.id or session.origin != "device":
        return _rejected(op, "id_taken")  # never say whose it is
    if session.kind != op.session_kind or session.deck_id != op.deck_id:
        return _rejected(op, "session_mismatch")
    if session.completed_at is not None or session.set_aside_at is not None:
        return _rejected(op, "session_closed")
    return session


def _new_session(db: Session, user: User, op: StudyAnswer) -> LearningSession:
    session = LearningSession(
        id=op.session_id,
        user_id=user.id,
        deck_id=op.deck_id,
        kind=op.session_kind,
        plan=[],
        started_at=op.answered_at,
        origin="device",
    )
    if op.session_kind == "study":
        # The day's plan as it stood when the lesson began (pace.recorded_target).
        today = pace.day_plan(db, user, op.deck_id, op.answered_at, zone_of(user))
        session.day_target = pace.recorded_target(today, pace.words_left(db, user))
        session.promised_days = user.study_days_per_week
    db.add(session)
    db.flush()
    return session


def _word_refusal(db: Session, user: User, op: StudyAnswer) -> str | None:
    """The answered word must be one of the lesson's deck; hard words and spelling are of words
    already met."""
    in_deck = db.scalar(
        select(DeckWord.word_id).where(
            DeckWord.deck_id == op.deck_id, DeckWord.word_id == op.word_id
        )
    )
    if in_deck is None:
        return "word_not_found"
    if op.session_kind != "study" and db.get(UserWordProgress, (user.id, op.word_id)) is None:
        return "not_met"
    return None


def apply_answer(db: Session, user: User, op: StudyAnswer, now: datetime) -> OpResult:
    """One answer of a device's lesson, applied at the moment it was given. Everything is checked
    before anything is written. Raises ApiError when the deck is not one I may study, which sync
    reports as a refusal."""
    spelling = isinstance(op.response, SpellingResponse)
    code = refusal(db, user, op.device_id, op.answered_at, now)
    if code is None and (
        spelling != (op.session_kind == "spelling") or op.exercise_id.startswith("s") != spelling
    ):
        code = "wrong_response"
    if code:
        return _rejected(op, code)
    session = _session_for(db, user, op)
    if isinstance(session, OpResult):
        return session
    attempts = sessions.attempts_of(db, session.id) if session else {}
    if op.exercise_id in attempts:
        return OpResult(op_id=op.op_id, status="duplicate")
    code = _word_refusal(db, user, op)
    if code:
        return _rejected(op, code)
    if session is None:
        session = _new_session(db, user, op)
    step = PlannedExercise(
        op.exercise_id,
        "spelling" if spelling else "card",
        op.word_id,
        new=op.new,
        hint=op.hint,
    )
    plan = [*sessions.plan_of(session), step]
    session.plan = [planned.to_json() for planned in plan]
    word = db.get_one(Word, op.word_id)
    if isinstance(op.response, SpellingResponse):
        sessions.spell_word(db, user, session, step, word, op.response, op.answered_at)
    else:
        sessions.rate_card(
            db,
            user,
            session,
            plan,
            step,
            word,
            op.response,
            attempts,
            op.answered_at,
            requeue_cards=False,
        )
    return OpResult(op_id=op.op_id, status="applied")


def apply_finish(db: Session, user: User, op: StudyFinish, now: datetime) -> OpResult:
    """The end of a device's lesson. Its days count once it is finished, as any lesson's do."""
    session = db.get(LearningSession, op.session_id)
    if session is None or session.user_id != user.id or session.origin != "device":
        # A lesson nothing was answered in is never sent.
        return _rejected(op, "session_not_found")
    if session.completed_at is not None or session.set_aside_at is not None:
        return OpResult(op_id=op.op_id, status="duplicate")
    code = refusal(db, user, op.device_id, op.finished_at, now)
    if code:
        return _rejected(op, code)
    # Never before its own answers, whatever the device's clock said.
    last = db.scalar(
        select(func.max(ReviewAttempt.answered_at)).where(ReviewAttempt.session_id == session.id)
    )
    moment = max(op.finished_at, last) if last else op.finished_at
    if op.set_aside:
        session.set_aside_at = moment
    else:
        session.completed_at = moment
    return OpResult(op_id=op.op_id, status="applied")


# --- the pack -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Pack:
    body: bytes
    etag: str


def _studied_decks(db: Session, user: User) -> list[tuple[Deck, DeckKind, date | None]]:
    """Every deck I study, with its kind for the device and a group's deadline: the course's
    levels in order (when the course is mine to study), my own decks, then decks given to my
    groups."""
    found: list[tuple[Deck, DeckKind, date | None]] = []
    if decks.course_open(user):
        course = db.scalars(
            select(Deck)
            .where(Deck.kind == "course", Deck.status == "published")
            .order_by(Deck.level_order, Deck.id)
        )
        found += [(deck, "course", None) for deck in course]
    mine = db.scalars(
        select(Deck)
        .where(Deck.kind == "user", Deck.owner_id == user.id)
        .order_by(Deck.created_at, Deck.id)
    )
    found += [(deck, "mine", None) for deck in mine]
    given = decks.assigned_decks(db, user)
    deadline = {item.deck.id: item.due_on for item in given}
    seen = {deck.id for deck, _, _ in found}
    found = [(deck, kind, deadline.get(deck.id)) for deck, kind, _ in found]
    found += [(item.deck, "group", item.due_on) for item in given if item.deck.id not in seen]
    return found


def _words_in(db: Session, deck_ids: Iterable[str]) -> dict[str, list[str]]:
    order: dict[str, list[str]] = {}
    rows = db.execute(
        select(DeckWord.deck_id, DeckWord.word_id)
        .where(DeckWord.deck_id.in_(list(deck_ids)))
        .order_by(DeckWord.deck_id, DeckWord.position)
    )
    for deck_id, word_id in rows:
        order.setdefault(deck_id, []).append(word_id)
    return order


def _introduced(db: Session, user: User, now: datetime) -> list[PackIntroduced]:
    """New words met yesterday and today in each pace (`pace.day_plan` counts the same)."""
    zone = zone_of(user)
    today = local_date(now, zone)
    since, _ = local_day_bounds(today - timedelta(days=1), zone)
    scope = case((Deck.kind == "course", "course"), else_=LearningSession.deck_id)
    local_day = func.date(func.timezone(zone.key, ReviewAttempt.answered_at))
    rows = db.execute(
        select(scope, local_day, func.count())
        .join(LearningSession, LearningSession.id == ReviewAttempt.session_id)
        .join(Deck, Deck.id == LearningSession.deck_id)
        .where(ReviewAttempt.user_id == user.id, INTRODUCTION, ReviewAttempt.answered_at >= since)
        .group_by(scope, local_day)
        .order_by(scope, local_day)
    )
    return [PackIntroduced(scope=key, day=day, words=int(count)) for key, day, count in rows]


def pack(db: Session, user: User, now: datetime) -> Pack:
    """What a device needs to study every deck of mine by itself, tagged with its content."""
    zone = zone_of(user)
    studied = _studied_decks(db, user)
    order = _words_in(db, [deck.id for deck, _, _ in studied])
    paces = {
        row.deck_id: row for row in db.scalars(select(DeckPace).where(DeckPace.user_id == user.id))
    }
    course_pace = pace.target_of(user)

    def pace_of(deck: Deck, due_on: date | None) -> PackPace:
        row = paces.get(deck.id)
        own = row.daily_new if row is not None and deck.kind != "course" else None
        return PackPace(
            daily_new=own if own is not None else course_pace,
            due_on=due_on,
            extra_day=row.extra_day if row is not None and row.extra_words else None,
            extra_words=int(row.extra_words or 0) if row is not None else 0,
        )

    word_ids = {word for ids in order.values() for word in ids}
    words = db.scalars(select(Word).where(Word.id.in_(word_ids)).order_by(Word.id))
    progress = db.scalars(
        select(UserWordProgress)
        .where(UserWordProgress.user_id == user.id)
        .order_by(UserWordProgress.word_id)
    )
    ladder = db.scalars(
        select(SpellingProgress)
        .where(SpellingProgress.user_id == user.id)
        .order_by(SpellingProgress.word_id)
    )
    out = StudyPackOut(
        time_zone=zone.key,
        course_open=decks.course_open(user),
        ramp_enabled=user.ramp_enabled,
        started_on=local_date(user.onboarded_at, zone) if user.onboarded_at else None,
        decks=[
            PackDeck(
                id=deck.id,
                kind=kind,
                title=deck.title,
                level=deck.level,
                level_order=deck.level_order,
                word_ids=order.get(deck.id, []),
                pace=pace_of(deck, due_on),
            )
            for deck, kind, due_on in studied
        ],
        words=[
            PackWord(
                id=word.id,
                headword=word.headword,
                pos=word.pos,
                translation=word.translation,
                example=word.example,
                example_translation=word.example_translation,
                language=word.language,
                illustration=word.illustration,
            )
            for word in words
        ],
        progress=[
            (
                row.word_id,
                row.fsrs_state,
                row.fsrs_step,
                row.stability,
                row.difficulty,
                row.due_at,
                row.last_reviewed_at,
                row.introduced_at,
                row.first_recalled_at,
                row.lapses,
            )
            for row in progress
        ],
        ladder=[(row.word_id, row.rung, row.due_at, row.last_spelled_at) for row in ladder],
        introduced=_introduced(db, user, now),
    )
    body = out.model_dump_json().encode()
    return Pack(body, f'"{hashlib.sha256(body).hexdigest()[:20]}"')


def pack_for(
    db: Session, user: User, device_id: UUID, now: datetime, sent_zone: ZoneInfo | None
) -> Pack:
    """The pack, and this device's contact noted: answers it gives from now on are dated after
    this moment. The device's zone is kept first: its days are the ones its answers will be
    counted in."""
    me.remember_time_zone(db, user, sent_zone)
    built = pack(db, user, now)
    touch(db, user, device_id, now)
    db.commit()
    return built
