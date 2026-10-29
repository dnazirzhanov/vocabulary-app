"""Teachers' decks and giving them to a group (ADR 0017).

A teacher (a group's owner) writes a deck of words for a lesson, publishes it and gives it to the
group. Its members meet the words in their own daily lesson, before the course's next words and
within the same daily pace, so the day's promise and the board stay as they are. Whoever gave a
deck is a member too and learns it the same way. Each learner's schedule stays their own.

A word the course already has (same spelling and part of speech) is linked rather than copied,
so nobody learns it twice. A published deck can be corrected and added to; a word taken out of
it is no longer introduced, while learners keep what they learned.
"""

import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased

from app.core.errors import ApiError
from app.models import (
    Deck,
    DeckAssignment,
    DeckWord,
    Group,
    GroupMember,
    LearningSession,
    ReviewAttempt,
    User,
    UserWordProgress,
    Word,
)
from app.schemas.decks import (
    AssignedGroupOut,
    DeckWordIn,
    FillIn,
    GenerateIn,
    GenerateOut,
    NewDeckIn,
    SkippedOut,
    SuggestIn,
    SuggestOut,
    TeacherDeckOut,
    TeacherWordOut,
    valid_headword,
)
from app.schemas.groups import AssignmentMemberOut, AssignmentOut, GroupProgressOut
from app.schemas.learning import WordOut
from app.services.generation import DraftCard, Provider, flags
from app.services.scheduling import REVIEW, WELL_LEARNED_STABILITY_DAYS

MAX_WORDS_PER_DECK = 50
MAX_DECKS_PER_USER = 100


def _new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(6)}"


def _word_out(word: Word) -> WordOut:
    return WordOut(
        id=word.id,
        headword=word.headword,
        pos=word.pos,
        translation=word.translation,
        example=word.example,
        example_ru=word.example_ru,
        illustration=word.illustration,
    )


# --- who may do what ------------------------------------------------------------------------


def _owned_deck(db: Session, user: User, deck_id: str) -> Deck:
    # Someone else's deck is indistinguishable from a missing one.
    deck = db.scalar(
        select(Deck).where(Deck.id == deck_id, Deck.kind == "user", Deck.owner_id == user.id)
    )
    if deck is None:
        raise ApiError(404, "deck_not_found", "Deck not found")
    return deck


def _owned_group(db: Session, user: User, group_id: UUID) -> Group:
    """A group I own. Not a member: 404, as for any group; a member: 403 (they can see it)."""
    row = db.execute(
        select(Group, GroupMember.role)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(Group.id == group_id, GroupMember.user_id == user.id)
    ).one_or_none()
    if row is None:
        raise ApiError(404, "group_not_found", "Group not found")
    if row[1] != "owner":
        raise ApiError(403, "not_group_owner", "Only the group's owner can give it words")
    return row[0]


def _active_assignments(user: User) -> Select[str, datetime, UUID]:
    """Decks given to groups I am in, mine included: the giver learns them too, at their own
    pace."""
    return (
        select(DeckAssignment.deck_id, DeckAssignment.assigned_at, DeckAssignment.group_id)
        .join(GroupMember, GroupMember.group_id == DeckAssignment.group_id)
        .join(Deck, Deck.id == DeckAssignment.deck_id)
        .where(
            GroupMember.user_id == user.id,
            DeckAssignment.removed_at.is_(None),
            Deck.status == "published",
        )
    )


def visible_deck(db: Session, user: User, deck_id: str) -> Deck:
    """A deck I may study or browse: a published course level, a deck given to one of my groups,
    or one I wrote (in any state)."""
    deck = db.get(Deck, deck_id)
    # My own deck is mine to study from the start; a personal deck is never "published".
    if deck is not None and deck.owner_id == user.id:
        return deck
    if deck is not None and deck.status == "published":
        if deck.kind == "course":
            return deck
        given = _active_assignments(user).where(DeckAssignment.deck_id == deck_id).limit(1)
        if db.execute(given).first() is not None:
            return deck
    raise ApiError(404, "deck_not_found", "Deck not found")


# --- what learners get ----------------------------------------------------------------------


@dataclass(frozen=True)
class GivenDeck:
    """A deck given to one of my groups and where it comes from."""

    deck: Deck
    group_name: str
    # The author's nickname in that group; None once they left it or deleted their account.
    author: str | None
    is_mine: bool


def assigned_decks(db: Session, user: User) -> list[GivenDeck]:
    """Decks given to my groups, oldest first, with their group and author (the first group to
    give a deck names it)."""
    given = _active_assignments(user).subquery()
    author = aliased(GroupMember)
    rows = db.execute(
        select(Deck, Group.name, author.nickname)
        .join(given, given.c.deck_id == Deck.id)
        .join(Group, Group.id == given.c.group_id)
        .outerjoin(author, and_(author.group_id == Group.id, author.user_id == Deck.owner_id))
        .order_by(given.c.assigned_at, Deck.id)
    ).all()
    seen: dict[str, GivenDeck] = {}
    for deck, group_name, nickname in rows:
        seen.setdefault(
            deck.id, GivenDeck(deck, group_name, nickname, is_mine=deck.owner_id == user.id)
        )
    return list(seen.values())


def shared_groups(db: Session, user: User) -> dict[str, list[AssignedGroupOut]]:
    """For each of my decks, the groups it is given to now."""
    rows = db.execute(
        select(Deck.id, Group.id, Group.name)
        .join(DeckAssignment, DeckAssignment.deck_id == Deck.id)
        .join(Group, Group.id == DeckAssignment.group_id)
        .where(Deck.owner_id == user.id, DeckAssignment.removed_at.is_(None))
        .order_by(DeckAssignment.assigned_at)
    )
    shared: dict[str, list[AssignedGroupOut]] = {}
    for deck_id, group_id, name in rows:
        shared.setdefault(deck_id, []).append(AssignedGroupOut(id=group_id, name=name))
    return shared


# --- writing a deck -------------------------------------------------------------------------


def _deck_out(db: Session, deck: Deck) -> TeacherDeckOut:
    words = db.execute(
        select(Word)
        .join(DeckWord, DeckWord.word_id == Word.id)
        .where(DeckWord.deck_id == deck.id)
        .order_by(DeckWord.position)
    ).scalars()
    groups = db.execute(
        select(Group.id, Group.name)
        .join(DeckAssignment, DeckAssignment.group_id == Group.id)
        .where(DeckAssignment.deck_id == deck.id, DeckAssignment.removed_at.is_(None))
        .order_by(DeckAssignment.assigned_at)
    ).all()
    return TeacherDeckOut(
        id=deck.id,
        title=deck.title,
        status="published" if deck.status == "published" else "draft",
        created_at=deck.created_at,
        words=[_teacher_word(deck, word) for word in words],
        groups=[AssignedGroupOut(id=group_id, name=name) for group_id, name in groups],
    )


def _teacher_word(deck: Deck, word: Word) -> TeacherWordOut:
    own = word.owner_deck_id == deck.id
    return TeacherWordOut(
        word=_word_out(word),
        from_course=not own,
        source_sentence=word.source_sentence,
        flags=flags(word.headword, word.translation, word.example) if own else [],
    )


def create_deck(db: Session, user: User, body: NewDeckIn, now: datetime) -> TeacherDeckOut:
    """Anyone makes a deck; it is theirs until they give it to a group they own (ADR 0019)."""
    count = db.scalar(select(func.count()).where(Deck.owner_id == user.id))
    if (count or 0) >= MAX_DECKS_PER_USER:
        raise ApiError(409, "too_many_decks", "Too many decks")
    deck = Deck(
        id=_new_id("g"),
        title=body.title,
        description="",
        learning_language="en",
        explanation_language="ru",
        status="draft",
        content_version=1,
        level=None,
        level_order=0,
        kind="user",
        owner_id=user.id,
        created_at=now,
    )
    db.add(deck)
    db.commit()
    return _deck_out(db, deck)


def my_decks(db: Session, user: User) -> list[TeacherDeckOut]:
    decks = db.scalars(
        select(Deck)
        .where(Deck.kind == "user", Deck.owner_id == user.id)
        .order_by(Deck.created_at.desc(), Deck.id)
    )
    return [_deck_out(db, deck) for deck in decks]


def get_deck(db: Session, user: User, deck_id: str) -> TeacherDeckOut:
    return _deck_out(db, _owned_deck(db, user, deck_id))


def rename(db: Session, user: User, deck_id: str, title: str) -> TeacherDeckOut:
    deck = _owned_deck(db, user, deck_id)
    deck.title = title
    db.commit()
    return _deck_out(db, deck)


def _course_word(db: Session, headword: str, pos: str) -> Word | None:
    return db.scalar(
        select(Word)
        .join(DeckWord, DeckWord.word_id == Word.id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(
            Deck.kind == "course",
            Deck.status == "published",
            func.lower(Word.headword) == headword,
            Word.pos == pos,
        )
        .limit(1)
    )


def _deck_word_ids(db: Session, deck_id: str) -> list[str]:
    return list(
        db.scalars(
            select(DeckWord.word_id).where(DeckWord.deck_id == deck_id).order_by(DeckWord.position)
        )
    )


def _same_headword(db: Session, deck_id: str, headword: str, but: str | None = None) -> bool:
    query = (
        select(Word.id)
        .join(DeckWord, DeckWord.word_id == Word.id)
        .where(DeckWord.deck_id == deck_id, func.lower(Word.headword) == headword)
    )
    if but is not None:
        query = query.where(Word.id != but)
    return db.scalar(query.limit(1)) is not None


def _append(db: Session, deck: Deck, body: DeckWordIn, source_sentence: str | None = None) -> None:
    """A word at the end of the deck: the course's own when it has it, else a new word of the
    deck. The caller checks for room and duplicates and commits."""
    word = _course_word(db, body.headword, body.pos)
    if word is None:
        word = Word(
            id=_new_id("t"),
            headword=body.headword,
            pos=body.pos,
            translation=body.translation,
            also_accept=[],
            example=body.example,
            example_ru=body.example_ru,
            illustration=None,
            owner_deck_id=deck.id,
            source_sentence=source_sentence,
        )
        db.add(word)
        db.flush()
    last = db.scalar(select(func.max(DeckWord.position)).where(DeckWord.deck_id == deck.id))
    db.add(DeckWord(deck_id=deck.id, word_id=word.id, position=(last or 0) + 1))
    db.flush()


def add_word(db: Session, user: User, deck_id: str, body: DeckWordIn) -> TeacherDeckOut:
    deck = _owned_deck(db, user, deck_id)
    if len(_deck_word_ids(db, deck.id)) >= MAX_WORDS_PER_DECK:
        raise ApiError(409, "deck_full", f"A deck holds at most {MAX_WORDS_PER_DECK} words")
    if _same_headword(db, deck.id, body.headword):
        raise ApiError(409, "word_in_deck", "This word is already in the deck")
    _append(db, deck, body)
    db.commit()
    return _deck_out(db, deck)


def generate(
    db: Session, user: User, deck_id: str, body: GenerateIn, provider: Provider
) -> GenerateOut:
    """Draft cards from the teacher's text into the deck (ADR 0018). The text is read once and
    not kept; each card keeps only its own sentence. Cards that cannot be saved are reported."""
    deck = _owned_deck(db, user, deck_id)
    present = _present(db, deck)
    room = MAX_WORDS_PER_DECK - len(present)
    if room <= 0:
        raise ApiError(409, "deck_full", f"A deck holds at most {MAX_WORDS_PER_DECK} words")
    cards = provider.draft(body.text, min(body.count, room), body.level, list(present))
    added, skipped = _save_drafts(db, deck, cards, set(present), room)
    db.commit()
    return GenerateOut(
        deck=_deck_out(db, deck), added=added, skipped=skipped, provider=provider.name
    )


def _present(db: Session, deck: Deck) -> list[str]:
    return list(
        db.scalars(
            select(func.lower(Word.headword))
            .join(DeckWord, DeckWord.word_id == Word.id)
            .where(DeckWord.deck_id == deck.id)
        )
    )


def _save_drafts(
    db: Session, deck: Deck, cards: list[DraftCard], taken: set[str], room: int
) -> tuple[int, list[SkippedOut]]:
    """Checked cards into the deck; the caller commits. Unusable ones are reported, not dropped
    in silence."""
    added = 0
    skipped: list[SkippedOut] = []
    for card in cards:
        headword = " ".join(card.headword.strip().lower().split())
        if not valid_headword(headword):
            skipped.append(SkippedOut(headword=card.headword[:64], reason="invalid"))
        elif headword in taken:
            skipped.append(SkippedOut(headword=headword, reason="duplicate"))
        elif len(headword) > 64 or len(card.translation) > 120 or len(card.example) > 300:
            skipped.append(SkippedOut(headword=headword[:64], reason="too_long"))
        elif added >= room:
            skipped.append(SkippedOut(headword=headword, reason="full"))
        else:
            fields = DeckWordIn(
                headword=headword,
                pos=card.pos,
                translation=card.translation.strip(),
                example=card.example.strip(),
                example_ru=card.example_ru.strip()[:300],
            )
            _append(db, deck, fields, card.source_sentence.strip() or None)
            taken.add(headword)
            added += 1
    return added, skipped


def fill(db: Session, user: User, deck_id: str, body: FillIn, provider: Provider) -> GenerateOut:
    """Full cards from words the learner names (ADR 0019): the AI writes meaning, part of speech
    and example; the same checks as a draft from text."""
    deck = _owned_deck(db, user, deck_id)
    present = _present(db, deck)
    room = MAX_WORDS_PER_DECK - len(present)
    if room <= 0:
        raise ApiError(409, "deck_full", f"A deck holds at most {MAX_WORDS_PER_DECK} words")
    # One card per word, however it was typed («Reluctant», «reluctant »), before paying for it.
    named: dict[str, str] = {}
    for word in body.words:
        named.setdefault(" ".join(word.lower().split()), word)
    cards = provider.fill(list(named.values()), body.level)
    added, skipped = _save_drafts(db, deck, cards, set(present), room)
    db.commit()
    return GenerateOut(
        deck=_deck_out(db, deck), added=added, skipped=skipped, provider=provider.name
    )


def suggest(
    db: Session, user: User, deck_id: str, body: SuggestIn, provider: Provider
) -> SuggestOut:
    """One card filled in for the manual form; nothing is saved until the learner adds it."""
    _owned_deck(db, user, deck_id)
    cards = provider.fill([body.headword], body.level)
    if not cards:
        raise ApiError(422, "generation_refused", "No card could be made for this word")
    card = cards[0]
    headword = " ".join(card.headword.strip().lower().split())
    return SuggestOut(
        headword=headword,
        pos=card.pos,
        translation=card.translation.strip()[:120],
        example=card.example.strip()[:300],
        example_ru=card.example_ru.strip()[:300],
        flags=flags(headword, card.translation, card.example),
        provider=provider.name,
    )


def _deck_word(db: Session, deck: Deck, word_id: str) -> Word:
    word = db.scalar(
        select(Word)
        .join(DeckWord, DeckWord.word_id == Word.id)
        .where(DeckWord.deck_id == deck.id, Word.id == word_id)
    )
    if word is None:
        raise ApiError(404, "word_not_found", "Word not found in this deck")
    return word


def edit_word(
    db: Session, user: User, deck_id: str, word_id: str, body: DeckWordIn
) -> TeacherDeckOut:
    """Corrections are allowed after publishing: learners see the corrected word at its next
    showing, and their schedule is untouched."""
    deck = _owned_deck(db, user, deck_id)
    word = _deck_word(db, deck, word_id)
    if word.owner_deck_id != deck.id:
        raise ApiError(409, "course_word", "A course word is not edited here")
    if _same_headword(db, deck.id, body.headword, but=word.id):
        raise ApiError(409, "word_in_deck", "This word is already in the deck")
    word.headword = body.headword
    word.pos = body.pos
    word.translation = body.translation
    word.example = body.example
    word.example_ru = body.example_ru
    db.commit()
    return _deck_out(db, deck)


def remove_word(db: Session, user: User, deck_id: str, word_id: str) -> TeacherDeckOut:
    """Out of the deck: no longer introduced. A deck's own word nobody has met yet is deleted;
    one somebody met stays, so they keep reviewing it (a personal deck is studied as a draft)."""
    deck = _owned_deck(db, user, deck_id)
    word = _deck_word(db, deck, word_id)
    db.execute(delete(DeckWord).where(DeckWord.deck_id == deck.id, DeckWord.word_id == word.id))
    met = db.scalar(select(UserWordProgress.word_id).where(UserWordProgress.word_id == word.id))
    if word.owner_deck_id == deck.id and met is None:
        db.delete(word)
    db.commit()
    return _deck_out(db, deck)


def delete_deck(db: Session, user: User, deck_id: str) -> None:
    """Deletes my deck for good (ADR 0019): its own words and everyone's progress and answers on
    them, its unfinished lessons, and its assignments to groups. Finished lessons stay as history
    (their deck becomes null), so answers on a course word linked into it keep counting. One
    transaction."""
    deck = _owned_deck(db, user, deck_id)
    own = select(Word.id).where(Word.owner_deck_id == deck.id)
    words = list(db.scalars(own))
    # Unfinished lessons of this deck, or that would still show one of its words (spelling covers
    # today's words from any deck), can't be resumed: they go, with their answers.
    shows_its_words = [
        LearningSession.plan.op("@>")(
            func.jsonb_build_array(func.jsonb_build_object("word_id", word))
        )
        for word in words
    ]
    db.execute(
        delete(LearningSession).where(
            LearningSession.completed_at.is_(None),
            or_(LearningSession.deck_id == deck.id, *shows_its_words),
        )
    )
    db.execute(delete(ReviewAttempt).where(ReviewAttempt.word_id.in_(own)))
    db.execute(delete(UserWordProgress).where(UserWordProgress.word_id.in_(own)))
    # The deck's rows in deck_words, its assignments and its own words go with it (cascade).
    db.delete(deck)
    db.commit()


# --- giving a deck to a group ---------------------------------------------------------------


def publish(db: Session, user: User, deck_id: str, group_id: UUID, now: datetime) -> TeacherDeckOut:
    """Publish the deck and give it to a group I own. Repeating it changes nothing; a deck taken
    back is given again."""
    deck = _owned_deck(db, user, deck_id)
    group = _owned_group(db, user, group_id)
    if not _deck_word_ids(db, deck.id):
        raise ApiError(409, "deck_empty", "Add a word first")
    deck.status = "published"
    db.execute(
        insert(DeckAssignment)
        .values(group_id=group.id, deck_id=deck.id, assigned_by=user.id, assigned_at=now)
        .on_conflict_do_update(
            index_elements=[DeckAssignment.group_id, DeckAssignment.deck_id],
            set_={"removed_at": None},
            where=DeckAssignment.removed_at.is_not(None),
        )
    )
    db.commit()
    return _deck_out(db, deck)


def take_back(db: Session, user: User, group_id: UUID, deck_id: str, now: datetime) -> None:
    """Its words are no longer introduced to the group; what was learned stays."""
    group = _owned_group(db, user, group_id)
    assignment = db.scalar(
        select(DeckAssignment).where(
            DeckAssignment.group_id == group.id,
            DeckAssignment.deck_id == deck_id,
            DeckAssignment.removed_at.is_(None),
        )
    )
    if assignment is None:
        raise ApiError(404, "assignment_not_found", "This deck is not given to the group")
    assignment.removed_at = now
    db.commit()


# --- on the board ---------------------------------------------------------------------------


def board_assignments(
    db: Session, group_id: UUID, me: GroupMember, members: Sequence[GroupMember]
) -> list[AssignmentOut]:
    """Decks given to the group, with my own count of words met; the owner sees everyone's,
    their own included."""
    given = db.execute(
        select(DeckAssignment, Deck)
        .join(Deck, Deck.id == DeckAssignment.deck_id)
        .where(DeckAssignment.group_id == group_id, DeckAssignment.removed_at.is_(None))
        .order_by(DeckAssignment.assigned_at)
    ).all()
    if not given:
        return []
    deck_ids = [deck.id for _, deck in given]
    sizes = dict(
        db.execute(
            select(DeckWord.deck_id, func.count())
            .where(DeckWord.deck_id.in_(deck_ids))
            .group_by(DeckWord.deck_id)
        ).all()
    )
    well_learned = (UserWordProgress.fsrs_state == REVIEW) & (
        UserWordProgress.stability >= WELL_LEARNED_STABILITY_DAYS
    )
    counts: dict[tuple[str, UUID], tuple[int, int]] = {
        (deck_id, user_id): (int(met), int(known))
        for deck_id, user_id, met, known in db.execute(
            select(
                DeckWord.deck_id,
                UserWordProgress.user_id,
                func.count(),
                func.count().filter(well_learned),
            )
            .join(
                UserWordProgress,
                and_(
                    UserWordProgress.word_id == DeckWord.word_id,
                    UserWordProgress.user_id.in_([member.user_id for member in members]),
                ),
            )
            .where(DeckWord.deck_id.in_(deck_ids))
            .group_by(DeckWord.deck_id, UserWordProgress.user_id)
        ).all()
    }
    nicknames = {member.user_id: member.nickname for member in members}

    def out(assignment: DeckAssignment, deck: Deck) -> AssignmentOut:
        size = int(sizes.get(deck.id, 0))
        each = {member.user_id: counts.get((deck.id, member.user_id), (0, 0)) for member in members}
        return AssignmentOut(
            deck_id=deck.id,
            title=deck.title,
            author=nicknames.get(deck.owner_id) if deck.owner_id else None,
            is_mine=deck.owner_id == me.user_id,
            word_count=size,
            assigned_at=assignment.assigned_at,
            mine=each[me.user_id][0],
            group=GroupProgressOut(
                met=sum(min(met, size) for met, _ in each.values()),
                total=size * len(members),
                finished=sum(1 for met, _ in each.values() if size and met >= size),
                learners=len(members),
            ),
            members=[
                AssignmentMemberOut(
                    member_id=member.id, met=each[member.user_id][0], known=each[member.user_id][1]
                )
                for member in members
            ]
            if me.role == "owner"
            else None,
        )

    return [out(assignment, deck) for assignment, deck in given]
