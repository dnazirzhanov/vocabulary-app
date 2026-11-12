"""A reading given to a group (Reading Mode, round 2, D): one step instead of a photo in the chat
and words sent separately. The text (a library article or the giver's own), the words to learn from
it (a deck given to the group with it, studied as any group deck), its questions (the giver's copy,
changed as they like) and a deadline.

Any member may give a reading to their group (the owner's decision, 2026-11-12); its giver and the
group's owner may take it back. Members answer its questions; what they answered is theirs, the
giver's and the group owner's to read (D2).
"""

import uuid
from datetime import datetime

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import (
    DeckAssignment,
    Group,
    GroupMember,
    Reading,
    ReadingAssignment,
    ReadingQuestion,
    User,
)
from app.schemas.readings import AssignmentOut, GiveReadingIn, QuestionOut
from app.services import decks
from app.services.groups import membership
from app.services.reading import library_titles


def _title(db: Session, user: User, reading_ref: str) -> tuple[str, str]:
    """The text's title and the language of its meanings, if the giver may give it: a library
    article, or a text of their own."""
    if reading_ref.startswith("library:"):
        title = library_titles().get(reading_ref)
        if title is not None:
            return title, "ru"
    else:
        reading = db.get(Reading, uuid.UUID(reading_ref.removeprefix("reading:")))
        if reading is not None and reading.owner_id == user.id:
            return reading.title, reading.language
    raise ApiError(404, "reading_not_found", "No such text")


def _questions(db: Session, assignment_id: uuid.UUID) -> list[ReadingQuestion]:
    return list(
        db.scalars(
            select(ReadingQuestion)
            .where(ReadingQuestion.assignment_id == assignment_id)
            .order_by(ReadingQuestion.position)
        )
    )


def _question_out(one: ReadingQuestion) -> QuestionOut:
    return QuestionOut(
        id=f"question:{one.id}",
        kind=one.kind,
        q=one.text,
        options=one.options,
        answer=one.answer,
        min=one.min_words,
        max=one.max_words,
    )


def _out(
    db: Session, user: User, assignment: ReadingAssignment, group: Group, role: str
) -> AssignmentOut:
    giver = db.get(User, assignment.given_by) if assignment.given_by else None
    words = len(decks._deck_word_ids(db, assignment.deck_id)) if assignment.deck_id else 0
    return AssignmentOut(
        id=assignment.id,
        group_id=group.id,
        group_name=group.name,
        reading_ref=assignment.reading_ref,
        title=assignment.title,
        given_by=giver.name if giver else None,
        mine=assignment.given_by == user.id,
        can_take_back=assignment.given_by == user.id or role == "owner",
        deck_id=assignment.deck_id,
        words=words,
        due_on=assignment.due_on,
        given_at=assignment.given_at,
        questions=[_question_out(one) for one in _questions(db, assignment.id)],
    )


def give(db: Session, user: User, body: GiveReadingIn, now: datetime) -> AssignmentOut:
    group, member = membership(db, user, body.group_id)
    title, language = _title(db, user, body.reading_ref)
    decks._check_due(group, body.due_on, now)
    assignment = ReadingAssignment(
        id=uuid.uuid4(),
        group_id=group.id,
        reading_ref=body.reading_ref,
        title=title,
        given_by=user.id,
        due_on=body.due_on,
        given_at=now,
    )
    db.add(assignment)
    db.flush()
    if body.words:
        # The words as a deck of the giver's, given to the group: learned as any group deck, and
        # listed under «Из чтения» (it names this reading).
        deck = decks.new_deck(
            db, user, f"g-{uuid.uuid4()}", title[:80], language, now, f"assignment:{assignment.id}"
        )
        for word in body.words:
            try:
                with db.begin_nested():
                    decks.add_card(db, deck, word, now)
            except ApiError as error:
                if error.code != "word_in_deck":
                    raise
        deck.status = "published"
        decks.mark_deck(db, deck, now)
        db.execute(
            insert(DeckAssignment).values(
                group_id=group.id,
                deck_id=deck.id,
                assigned_by=user.id,
                assigned_at=now,
                due_on=body.due_on,
            )
        )
        assignment.deck_id = deck.id
    for position, one in enumerate(body.questions):
        db.add(
            ReadingQuestion(
                id=uuid.uuid4(),
                assignment_id=assignment.id,
                position=position,
                kind=one.kind,
                text=one.q,
                options=one.options if one.kind == "choice" else None,
                answer=one.answer if one.kind == "choice" else None,
                min_words=one.min if one.kind == "open" else None,
                max_words=one.max if one.kind == "open" else None,
            )
        )
    db.commit()
    return _out(db, user, assignment, group, member.role)


def mine(db: Session, user: User) -> list[AssignmentOut]:
    """Readings given to my groups, newest first (the ones I gave included)."""
    rows = db.execute(
        select(ReadingAssignment, Group, GroupMember.role)
        .join(Group, Group.id == ReadingAssignment.group_id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id, ReadingAssignment.removed_at.is_(None))
        .order_by(ReadingAssignment.given_at.desc())
    ).all()
    return [_out(db, user, assignment, group, role) for assignment, group, role in rows]


def _visible(
    db: Session, user: User, assignment_id: uuid.UUID
) -> tuple[ReadingAssignment, Group, str]:
    row = db.execute(
        select(ReadingAssignment, Group, GroupMember.role)
        .join(Group, Group.id == ReadingAssignment.group_id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            ReadingAssignment.id == assignment_id,
            ReadingAssignment.removed_at.is_(None),
            GroupMember.user_id == user.id,
        )
    ).first()
    # Not in its group, or taken back: as if it never was.
    if row is None:
        raise ApiError(404, "assignment_not_found", "No such reading")
    return row[0], row[1], row[2]


def get(db: Session, user: User, assignment_id: uuid.UUID) -> AssignmentOut:
    assignment, group, role = _visible(db, user, assignment_id)
    return _out(db, user, assignment, group, role)


def take_back(db: Session, user: User, assignment_id: uuid.UUID, now: datetime) -> None:
    """No longer the group's: its giver or the group's owner. Its words' deck goes with it; what
    was learned and answered stays."""
    assignment, group, role = _visible(db, user, assignment_id)
    if not (assignment.given_by == user.id or role == "owner"):
        raise ApiError(403, "not_allowed", "Only its giver or the group's owner can take it back")
    assignment.removed_at = now
    if assignment.deck_id:
        given = db.scalar(
            select(DeckAssignment).where(
                DeckAssignment.group_id == group.id,
                DeckAssignment.deck_id == assignment.deck_id,
                DeckAssignment.removed_at.is_(None),
            )
        )
        if given is not None:
            given.removed_at = now
    db.commit()


def may_read(db: Session, user: User, reading_id: uuid.UUID) -> bool:
    """A text of someone else's, given to one of my groups: mine to read."""
    return (
        db.scalar(
            select(ReadingAssignment.id)
            .join(GroupMember, GroupMember.group_id == ReadingAssignment.group_id)
            .where(
                ReadingAssignment.reading_ref == f"reading:{reading_id}",
                ReadingAssignment.removed_at.is_(None),
                GroupMember.user_id == user.id,
            )
            .limit(1)
        )
        is not None
    )


def may_answer(db: Session, user: User, assignment_id: uuid.UUID) -> bool:
    """A question of a reading given to one of my groups: mine to answer."""
    try:
        _visible(db, user, assignment_id)
    except ApiError:
        return False
    return True
