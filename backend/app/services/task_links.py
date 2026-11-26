"""A group task's material (ADR 0096): a deck, a reading, an essay question, a speaking question or
a shadowing exercise, linked by the group's teacher. Members open it from the task, and doing it
ticks the task for that day («по занятию»), as practising ticks a study task (ADR 0086).

A linked deck or reading is also given to the group, so every member can open it; an essay,
speaking question or shadowing exercise opens for the members of a group that links it, even
where its section isn't open to them yet (the owner, 26 November 2026)."""

import uuid
from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import (
    Deck,
    GroupMember,
    LearningSession,
    ReadingAnswer,
    ReadingAssignment,
    ShadowingAttempt,
    ShadowingExercise,
    SpeakingSession,
    Task,
    User,
    WritingSubmission,
)
from app.schemas.readings import GiveReadingIn
from app.schemas.tasks import LinkIn, LinkKind, LinkOut
from app.services.speaking import questions as speaking_bank
from app.services.writing import questions as writing_bank


def link_out(task: Task) -> LinkOut | None:
    if not task.link_kind or not task.link_ref:
        return None
    return LinkOut(kind=task.link_kind, ref=task.link_ref, title=task.link_title or "")


def attach(db: Session, user: User, group_id: uuid.UUID | None, link: LinkIn, now: datetime) -> str:
    """Checks the material and makes it the group's; its title. Only a group's task has one."""
    if group_id is None:
        raise ApiError(422, "link_needs_group", "Only a group's task links material")
    # Here, not at the top: these import the groups' services, which import the tasks'.
    from app.services import decks, reading_assignments

    if link.kind == "deck":
        deck = db.get(Deck, link.ref)
        if deck is None:
            raise ApiError(404, "deck_not_found", "No such deck")
        # Given to the group, as «Дать группе» does (the teacher's own deck, or a course level).
        decks.publish(db, user, link.ref, group_id, now)
        return deck.title
    if link.kind == "reading":
        given = db.scalar(
            select(ReadingAssignment.title).where(
                ReadingAssignment.group_id == group_id,
                ReadingAssignment.reading_ref == link.ref,
                ReadingAssignment.removed_at.is_(None),
            )
        )
        if given is not None:
            return given
        made = reading_assignments.give(
            db, user, GiveReadingIn(group_id=group_id, reading_ref=link.ref), now
        )
        return made.title
    if link.kind == "writing":
        question = writing_bank.get(link.ref)
        if question is None:
            raise ApiError(404, "question_not_found", "No such question")
        return question.title
    if link.kind == "speaking":
        spoken = speaking_bank.by_id(link.ref)
        if spoken is None:
            raise ApiError(404, "question_not_found", "No such question")
        return spoken.text
    exercise = _exercise(db, link.ref)
    if exercise is None:
        raise ApiError(404, "exercise_not_found", "No such exercise")
    return exercise.title


def _exercise(db: Session, ref: str) -> ShadowingExercise | None:
    try:
        return db.get(ShadowingExercise, uuid.UUID(ref))
    except ValueError:
        return None


def linked_refs(db: Session, user: User, kind: LinkKind) -> set[str]:
    """What my groups' tasks link, of one kind: these open for me (ADR 0096)."""
    groups = select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    return set(
        db.scalars(
            select(Task.link_ref).where(
                Task.group_id.in_(groups),
                Task.deleted_at.is_(None),
                Task.link_kind == kind,
                Task.link_ref.is_not(None),
            )
        )
    )


def done_days(
    db: Session,
    tasks: Iterable[Task],
    users: Iterable[User],
    since: datetime,
) -> dict[tuple[uuid.UUID, uuid.UUID], set[date]]:
    """For each linked task and learner, the days (on the learner's own clock) they did its
    material: a lesson finished on the deck, the reading's questions answered, the essay sent,
    the speaking or shadowing answer recorded."""
    linked = [t for t in tasks if t.link_kind and t.link_ref]
    people = {u.id: ZoneInfo(u.time_zone or "UTC") for u in users}
    found: dict[tuple[uuid.UUID, uuid.UUID], set[date]] = defaultdict(set)
    if not linked or not people:
        return found
    by_kind: dict[str, dict[str, list[Task]]] = defaultdict(lambda: defaultdict(list))
    for task in linked:
        by_kind[task.link_kind or ""][task.link_ref or ""].append(task)
    ids = list(people)

    def put(kind: str, ref: str, user_id: uuid.UUID, at: datetime | None) -> None:
        if at is None:
            return
        day = at.astimezone(people[user_id]).date()
        for task in by_kind[kind].get(ref, []):
            found[(task.id, user_id)].add(day)

    if "deck" in by_kind:
        for deck_id, user_id, at in db.execute(
            select(
                LearningSession.deck_id, LearningSession.user_id, LearningSession.completed_at
            ).where(
                LearningSession.user_id.in_(ids),
                LearningSession.deck_id.in_(list(by_kind["deck"])),
                LearningSession.completed_at >= since,
            )
        ):
            put("deck", deck_id or "", user_id, at)
    if "reading" in by_kind:
        for ref, user_id, at in db.execute(
            select(ReadingAnswer.reading_ref, ReadingAnswer.user_id, ReadingAnswer.sent_at).where(
                ReadingAnswer.user_id.in_(ids),
                ReadingAnswer.reading_ref.in_(list(by_kind["reading"])),
                ReadingAnswer.sent_at >= since,
            )
        ):
            put("reading", ref, user_id, at)
    if "writing" in by_kind:
        for ref, user_id, at in db.execute(
            select(
                WritingSubmission.question_id,
                WritingSubmission.user_id,
                WritingSubmission.created_at,
            ).where(
                WritingSubmission.user_id.in_(ids),
                WritingSubmission.question_id.in_(list(by_kind["writing"])),
                WritingSubmission.created_at >= since,
            )
        ):
            put("writing", ref, user_id, at)
    if "speaking" in by_kind:
        for ref, user_id, at in db.execute(
            select(
                SpeakingSession.question_id, SpeakingSession.user_id, SpeakingSession.completed_at
            ).where(
                SpeakingSession.user_id.in_(ids),
                SpeakingSession.question_id.in_(list(by_kind["speaking"])),
                SpeakingSession.status == "done",
                SpeakingSession.completed_at >= since,
            )
        ):
            put("speaking", ref or "", user_id, at)
    if "shadowing" in by_kind:
        exercise_ids = []
        for ref in by_kind["shadowing"]:
            try:
                exercise_ids.append(uuid.UUID(ref))
            except ValueError:
                continue
        for exercise_id, user_id, at in db.execute(
            select(
                ShadowingAttempt.exercise_id,
                ShadowingAttempt.user_id,
                ShadowingAttempt.completed_at,
            ).where(
                ShadowingAttempt.user_id.in_(ids),
                ShadowingAttempt.exercise_id.in_(exercise_ids),
                ShadowingAttempt.completed_at >= since,
            )
        ):
            put("shadowing", str(exercise_id), user_id, at)
    return found
