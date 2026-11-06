"""Teachers' decks and giving them to a group (ADR 0017).

A teacher (a group's owner) writes a deck of words for a lesson, publishes it and gives it to the
group. Its members meet the words in their own daily lesson, before the course's next words and
within the same daily pace, so the day's promise and the board stay as they are. Whoever gave a
deck is a member too and learns it the same way. Each learner's schedule stays their own.

A word the course already has (same spelling and part of speech) is linked rather than copied,
so nobody learns it twice. A published deck can be corrected and added to; a word taken out of
it is no longer introduced, while learners keep what they learned.
"""

import math
import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Select, and_, delete, exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased

from app.core.errors import ApiError
from app.models import (
    Deck,
    DeckAssignment,
    DeckSeenWord,
    DeckTopic,
    DeckWord,
    Group,
    GroupMember,
    LearningSession,
    ReviewAttempt,
    SpellingProgress,
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
    TopicIn,
    valid_headword,
)
from app.schemas.groups import (
    AssignmentOut,
    GroupProgressOut,
    StandingOut,
)
from app.schemas.learning import WordOut
from app.services.generation import DraftCard, Provider, flags, word_key
from app.services.group_rights import require
from app.services.scheduling import local_date

MAX_WORDS_PER_DECK = 500  # room to grow a topic deck day by day (ADR 0019)
# Photos read into a draft (ADR 0029): four at a time, eight per deck.
MAX_PHOTOS_PER_DECK = 8
# A topic draft: at most two calls; the AI is shown at most this many of the deck's words to avoid
# (about 3 tokens each; any it repeats beyond them are still dropped by key).
TOPIC_CALLS = 2
AVOID_LIMIT = 600


COURSE_LANGUAGE = "ru"


def over_ask(wanted: int) -> int:
    """A few spare words, since the AI sometimes repeats one it was told to avoid."""
    return max(3, -(-wanted * 3 // 10))


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
        example_translation=word.example_translation,
        language=word.language,
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
    require(row[1], "give_decks", "not_group_owner", "Only the group's owner can give it words")
    return row[0]


def _active_assignments(user: User) -> Select[str, datetime, UUID, date | None]:
    """Decks given to groups I am in, mine included: the giver learns them too, at their own
    pace."""
    return (
        select(
            DeckAssignment.deck_id,
            DeckAssignment.assigned_at,
            DeckAssignment.group_id,
            DeckAssignment.due_on,
        )
        .join(GroupMember, GroupMember.group_id == DeckAssignment.group_id)
        .join(Deck, Deck.id == DeckAssignment.deck_id)
        .where(
            GroupMember.user_id == user.id,
            DeckAssignment.removed_at.is_(None),
            Deck.status == "published",
        )
    )


def course_open(user: User) -> bool:
    """The course is written in Russian only, so it is for those studying in Russian (ADR 0055).
    An account not yet asked reads as Russian. Every path to course words goes through this."""
    return user.language in (None, COURSE_LANGUAGE)


def visible_deck(db: Session, user: User, deck_id: str) -> Deck:
    """A deck I may study or browse: a published course level, a deck given to one of my groups,
    or one I wrote (in any state)."""
    deck = db.get(Deck, deck_id)
    # My own deck is mine to study from the start; a personal deck is never "published".
    if deck is not None and deck.owner_id == user.id:
        return deck
    if deck is not None and deck.status == "published":
        if deck.kind == "course":
            if course_open(user):
                return deck
            raise ApiError(404, "deck_not_found", "Deck not found")
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
    # The earliest «Выучить к» among my groups that were given it (ADR 0028).
    due_on: date | None = None


def assigned_decks(db: Session, user: User) -> list[GivenDeck]:
    """Decks given to my groups, oldest first, with their group and author (the first group to
    give a deck names it)."""
    given = _active_assignments(user).subquery()
    author = aliased(GroupMember)
    rows = db.execute(
        select(Deck, Group.name, author.nickname, given.c.due_on)
        .join(given, given.c.deck_id == Deck.id)
        .join(Group, Group.id == given.c.group_id)
        .outerjoin(author, and_(author.group_id == Group.id, author.user_id == Deck.owner_id))
        .order_by(given.c.assigned_at, Deck.id)
    ).all()
    soonest: dict[str, date] = {}
    for deck, _, _, due_on in rows:
        if due_on is not None and (deck.id not in soonest or due_on < soonest[deck.id]):
            soonest[deck.id] = due_on
    seen: dict[str, GivenDeck] = {}
    for deck, group_name, nickname, _ in rows:
        seen.setdefault(
            deck.id,
            GivenDeck(
                deck,
                group_name,
                nickname,
                is_mine=deck.owner_id == user.id,
                due_on=soonest.get(deck.id),
            ),
        )
    return list(seen.values())


def shared_groups(db: Session, user: User) -> dict[str, list[AssignedGroupOut]]:
    """For each of my decks, the groups it is given to now."""
    rows = db.execute(
        select(Deck.id, Group.id, Group.name, DeckAssignment.due_on)
        .join(DeckAssignment, DeckAssignment.deck_id == Deck.id)
        .join(Group, Group.id == DeckAssignment.group_id)
        .where(Deck.owner_id == user.id, DeckAssignment.removed_at.is_(None))
        .order_by(DeckAssignment.assigned_at)
    )
    shared: dict[str, list[AssignedGroupOut]] = {}
    for deck_id, group_id, name, due_on in rows:
        shared.setdefault(deck_id, []).append(
            AssignedGroupOut(id=group_id, name=name, due_on=due_on)
        )
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
        select(Group.id, Group.name, DeckAssignment.due_on)
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
        groups=[
            AssignedGroupOut(id=group_id, name=name, due_on=due_on)
            for group_id, name, due_on in groups
        ],
        topics=list(
            db.scalars(
                select(DeckTopic.topic)
                .where(DeckTopic.deck_id == deck.id)
                .order_by(DeckTopic.used_at.desc(), DeckTopic.key)
            )
        ),
        photos_left=max(0, MAX_PHOTOS_PER_DECK - deck.photos_used),
        language=deck.explanation_language,
    )


def _teacher_word(deck: Deck, word: Word) -> TeacherWordOut:
    own = word.owner_deck_id == deck.id
    return TeacherWordOut(
        word=_word_out(word),
        from_course=not own,
        source_sentence=word.source_sentence,
        flags=flags(
            word.headword,
            word.translation,
            word.example,
            word.language,
            word.example_translation,
        )
        if own
        else [],
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
        explanation_language=body.language or user.language or COURSE_LANGUAGE,
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


def _use_language(deck: Deck, chosen: str | None) -> None:
    """The language these cards are made in, chosen where they are made (ADR 0055). A deck may hold
    several; it remembers the last, so the next card starts from it."""
    if chosen:
        deck.explanation_language = chosen


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
    # The course's meanings are Russian: a card in another language writes its own.
    language = body.language or deck.explanation_language
    word = _course_word(db, body.headword, body.pos) if language == COURSE_LANGUAGE else None
    if word is None:
        word = Word(
            id=_new_id("t"),
            headword=body.headword,
            pos=body.pos,
            translation=body.translation,
            also_accept=[],
            example=body.example,
            example_translation=body.example_translation,
            language=language,
            illustration=None,
            owner_deck_id=deck.id,
            source_sentence=source_sentence,
        )
        db.add(word)
        db.flush()
    last = db.scalar(select(func.max(DeckWord.position)).where(DeckWord.deck_id == deck.id))
    db.add(DeckWord(deck_id=deck.id, word_id=word.id, position=(last or 0) + 1))
    _remember(db, deck, word.headword)
    db.flush()


def _remember(db: Session, deck: Deck, headword: str) -> None:
    """The deck has had this word: the AI won't bring it again, even once it's taken out."""
    db.execute(
        insert(DeckSeenWord)
        .values(deck_id=deck.id, key=word_key(headword), headword=headword)
        .on_conflict_do_nothing()
    )


def _seen(db: Session, deck: Deck) -> dict[str, str]:
    """Every word the deck has had, removed ones too: key → the word as first written."""
    rows = db.execute(
        select(DeckSeenWord.key, DeckSeenWord.headword).where(DeckSeenWord.deck_id == deck.id)
    )
    return {key: headword for key, headword in rows}


def add_word(db: Session, user: User, deck_id: str, body: DeckWordIn) -> TeacherDeckOut:
    deck = _owned_deck(db, user, deck_id)
    _use_language(deck, body.language)
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
    not kept; each card keeps only its own sentence. Cards that cannot be saved are reported.
    Text read from photos counts them against the deck's eight (ADR 0029), once the draft
    succeeds."""
    deck = _owned_deck(db, user, deck_id)
    _use_language(deck, body.language)
    if deck.photos_used + body.photos > MAX_PHOTOS_PER_DECK:
        raise ApiError(
            409, "photo_limit", f"A deck takes at most {MAX_PHOTOS_PER_DECK} photos in all"
        )
    present = _present(db, deck)
    room = MAX_WORDS_PER_DECK - len(present)
    if room <= 0:
        raise ApiError(409, "deck_full", f"A deck holds at most {MAX_WORDS_PER_DECK} words")
    seen = _seen(db, deck)
    wanted = min(body.count, room)
    cards = provider.draft(
        body.text, wanted, body.level, list(seen.values()), deck.explanation_language
    )
    added, skipped, repeats = _save_drafts(db, deck, cards, set(seen), wanted)
    skipped += [SkippedOut(headword=word, reason="duplicate") for word in repeats]
    deck.photos_used += body.photos
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
    db: Session, deck: Deck, cards: list[DraftCard], taken: set[str], wanted: int
) -> tuple[int, list[SkippedOut], list[str]]:
    """Checked cards into the deck, up to `wanted`; the caller commits. Returns how many were
    added, the unusable ones (reported, never dropped in silence) and the words skipped because the
    deck has had them (`taken`: word keys, updated here). Cards past `wanted` are the over-ask's
    spare: unused, unreported."""
    added = 0
    skipped: list[SkippedOut] = []
    repeats: list[str] = []
    for card in cards:
        if added >= wanted:
            break
        headword = " ".join(card.headword.strip().lower().split())
        key = word_key(headword)
        if not valid_headword(headword):
            skipped.append(SkippedOut(headword=card.headword[:64], reason="invalid"))
        elif key in taken:
            repeats.append(headword)
        elif len(headword) > 64 or len(card.translation) > 120 or len(card.example) > 300:
            skipped.append(SkippedOut(headword=headword[:64], reason="too_long"))
        else:
            fields = DeckWordIn(
                headword=headword,
                pos=card.pos,
                translation=card.translation.strip(),
                example=card.example.strip(),
                example_translation=card.example_translation.strip()[:300],
            )
            _append(db, deck, fields, card.source_sentence.strip() or None)
            taken.add(key)
            added += 1
    return added, skipped, repeats


def fill(db: Session, user: User, deck_id: str, body: FillIn, provider: Provider) -> GenerateOut:
    """Full cards from words the learner names (ADR 0019): the AI writes meaning, part of speech
    and example; the same checks as a draft from text."""
    deck = _owned_deck(db, user, deck_id)
    _use_language(deck, body.language)
    present = _present(db, deck)
    room = MAX_WORDS_PER_DECK - len(present)
    if room <= 0:
        raise ApiError(409, "deck_full", f"A deck holds at most {MAX_WORDS_PER_DECK} words")
    # One card per word, however it was typed («Reluctant», «reluctant »), before paying for it.
    named: dict[str, str] = {}
    for word in body.words:
        named.setdefault(" ".join(word.lower().split()), word)
    cards = provider.fill(list(named.values()), body.level, deck.explanation_language)
    # Named on purpose: only a word in the deck now is a repeat (one taken out may come back).
    taken = {word_key(word) for word in present}
    added, skipped, repeats = _save_drafts(db, deck, cards, taken, room)
    skipped += [SkippedOut(headword=word, reason="duplicate") for word in repeats]
    db.commit()
    return GenerateOut(
        deck=_deck_out(db, deck), added=added, skipped=skipped, provider=provider.name
    )


def topic_key(topic: str) -> str:
    """A topic as compared: case, «ё» and spacing don't make a new one."""
    return " ".join(topic.lower().replace("ё", "е").split())[:80]


def topic(
    db: Session, user: User, deck_id: str, body: TopicIn, provider: Provider, now: datetime
) -> GenerateOut:
    """Cards for a topic (ADR 0019), never a word the deck has had — asked day after day, a topic
    deck keeps growing. The AI is told the deck's words to avoid; it is asked for a few more than
    wanted, since it sometimes repeats one anyway, and those are dropped by key; if it still falls
    short, one more call with its repeats added to the list. At most two calls."""
    deck = _owned_deck(db, user, deck_id)
    _use_language(deck, body.language)
    room = MAX_WORDS_PER_DECK - len(_present(db, deck))
    if room <= 0:
        raise ApiError(409, "deck_full", f"A deck holds at most {MAX_WORDS_PER_DECK} words")
    wanted = min(body.count, room)
    seen = _seen(db, deck)
    taken = set(seen)
    avoid = list(seen.values())[-AVOID_LIMIT:]
    added = 0
    skipped: list[SkippedOut] = []
    repeats: list[str] = []
    for _ in range(TOPIC_CALLS):
        ask = (wanted - added) + over_ask(wanted - added)
        cards = provider.topic(body.topic, ask, body.level, avoid, deck.explanation_language)
        more, problems, again = _save_drafts(db, deck, cards, taken, wanted - added)
        added += more
        skipped += problems
        repeats += again
        if added >= wanted or not cards:
            break
        avoid += [card.headword for card in cards]
    if added < wanted:
        skipped += [SkippedOut(headword=word, reason="duplicate") for word in repeats]
    # The deck's topic, offered next time; the latest wording and use win.
    db.execute(
        insert(DeckTopic)
        .values(deck_id=deck.id, key=topic_key(body.topic), topic=body.topic, used_at=now)
        .on_conflict_do_update(
            index_elements=[DeckTopic.deck_id, DeckTopic.key],
            set_={"topic": body.topic, "used_at": now},
        )
    )
    db.commit()
    return GenerateOut(
        deck=_deck_out(db, deck), added=added, skipped=skipped, provider=provider.name
    )


def suggest(
    db: Session, user: User, deck_id: str, body: SuggestIn, provider: Provider
) -> SuggestOut:
    """One card filled in for the manual form; nothing is saved until the learner adds it."""
    deck = _owned_deck(db, user, deck_id)
    _use_language(deck, body.language)  # nothing is saved here, so this isn't remembered
    cards = provider.fill([body.headword], body.level, deck.explanation_language)
    if not cards:
        raise ApiError(422, "generation_refused", "No card could be made for this word")
    card = cards[0]
    headword = " ".join(card.headword.strip().lower().split())
    return SuggestOut(
        headword=headword,
        pos=card.pos,
        translation=card.translation.strip()[:120],
        example=card.example.strip()[:300],
        example_translation=card.example_translation.strip()[:300],
        flags=flags(
            headword,
            card.translation,
            card.example,
            deck.explanation_language,
            card.example_translation,
        ),
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
    word.example_translation = body.example_translation
    if body.language:
        word.language = body.language
    db.commit()
    return _deck_out(db, deck)


def remove_word(db: Session, user: User, deck_id: str, word_id: str) -> TeacherDeckOut:
    """Out of the deck: no longer introduced. A deck's own word nobody has met yet is deleted;
    one somebody met stays, so they keep reviewing it (a personal deck is studied as a draft)."""
    deck = _owned_deck(db, user, deck_id)
    word = _deck_word(db, deck, word_id)
    db.execute(delete(DeckWord).where(DeckWord.deck_id == deck.id, DeckWord.word_id == word.id))
    met = db.scalar(select(UserWordProgress.word_id).where(UserWordProgress.word_id == word.id))
    # A group's test can put a word on someone's ladder before any lesson meets it (ADR 0048).
    on_ladder = db.scalar(
        select(SpellingProgress.word_id).where(SpellingProgress.word_id == word.id)
    )
    if word.owner_deck_id == deck.id and met is None and on_ladder is None:
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
    db.execute(delete(SpellingProgress).where(SpellingProgress.word_id.in_(own)))
    # The deck's rows in deck_words, its assignments and its own words go with it (cascade).
    db.delete(deck)
    db.commit()


# --- giving a deck to a group ---------------------------------------------------------------


def _check_due(group: Group, due_on: date | None, now: datetime) -> None:
    """A deadline is a day still to come in the group's time zone, today at the earliest."""
    if due_on is not None and due_on < local_date(now, ZoneInfo(group.time_zone)):
        raise ApiError(422, "due_in_past", "Pick today or a later day")


def decks_of(db: Session, user: User) -> list[str]:
    return list(db.scalars(select(Deck.id).where(Deck.owner_id == user.id)))


def delete_unshared(db: Session, deck_ids: list[str]) -> None:
    """A deleted author's decks that are theirs alone (ADR 0043). One given to a group stays with
    it, and so does one somebody learned from, even if that group is gone: their progress points
    at its words. Called once the author's own progress is gone."""
    its_word = Word.owner_deck_id == Deck.id
    db.execute(
        delete(Deck)
        .where(
            Deck.id.in_(deck_ids),
            ~exists().where(DeckAssignment.deck_id == Deck.id),
            ~exists().where(UserWordProgress.word_id == Word.id, its_word),
            ~exists().where(SpellingProgress.word_id == Word.id, its_word),
            ~exists().where(ReviewAttempt.word_id == Word.id, its_word),
        )
        .execution_options(synchronize_session=False)
    )


def publish(
    db: Session,
    user: User,
    deck_id: str,
    group_id: UUID,
    now: datetime,
    due_on: date | None = None,
) -> TeacherDeckOut:
    """Publish the deck and give it to a group I own, with an optional «Выучить к» (ADR 0028).
    Repeating it only sets the deadline. A deck taken back is given again, and undoing that keeps
    its deadline if the date is still to come (ADR 0049)."""
    deck = _owned_deck(db, user, deck_id)
    group = _owned_group(db, user, group_id)
    if not _deck_word_ids(db, deck.id):
        raise ApiError(409, "deck_empty", "Add a word first")
    _check_due(group, due_on, now)
    if due_on is None:
        taken_back = db.scalar(
            select(DeckAssignment.due_on).where(
                DeckAssignment.group_id == group.id,
                DeckAssignment.deck_id == deck.id,
                DeckAssignment.removed_at.is_not(None),
            )
        )
        if taken_back and taken_back >= local_date(now, ZoneInfo(group.time_zone)):
            due_on = taken_back
    deck.status = "published"
    db.execute(
        insert(DeckAssignment)
        .values(
            group_id=group.id,
            deck_id=deck.id,
            assigned_by=user.id,
            assigned_at=now,
            due_on=due_on,
        )
        .on_conflict_do_update(
            index_elements=[DeckAssignment.group_id, DeckAssignment.deck_id],
            set_={"removed_at": None, "due_on": due_on},
        )
    )
    db.commit()
    return _deck_out(db, deck)


def set_due(
    db: Session, user: User, group_id: UUID, deck_id: str, due_on: date | None, now: datetime
) -> TeacherDeckOut:
    """Change or remove the deadline of a deck given to a group I own (ADR 0028)."""
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
    _check_due(group, due_on, now)
    assignment.due_on = due_on
    db.commit()
    deck = db.get_one(Deck, deck_id)
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


def standing(met: int, total: int, given_on: date, due_on: date, today: date) -> StandingOut:
    """A member against a deadline (ADR 0030). The words are due, evenly, from the day the deck
    was given to the day before the deadline (the deadline day is for review); a member is behind
    by what they lack of the share up to yesterday, since today is still theirs. From the
    deadline on, anything not met is behind."""
    if total > 0 and met >= total:
        return StandingOut(status="done", behind=0)
    if today >= due_on:
        expected = total
    else:
        last = max(given_on, due_on - timedelta(days=1))
        days = (last - given_on).days + 1
        done_days = min(max((today - given_on).days, 0), days)
        expected = math.ceil(total * done_days / days)
    behind = max(0, expected - met)
    if met == 0:
        return StandingOut(status="not_started", behind=behind)
    return StandingOut(status="behind" if behind > 0 else "on_track", behind=behind)


def member_deck_progress(
    db: Session, deck_ids: Sequence[str], users: Sequence[UUID]
) -> dict[tuple[str, UUID], tuple[int, int]]:
    """For each (deck, learner): the deck's words met, and of those the ones learned — recalled in
    a later review with any answer but «Снова», the «знаю» of the progress page (ADR 0022)."""
    return {
        (deck_id, user_id): (int(met), int(learned))
        for deck_id, user_id, met, learned in db.execute(
            select(
                DeckWord.deck_id,
                UserWordProgress.user_id,
                func.count(),
                func.count().filter(UserWordProgress.first_recalled_at.is_not(None)),
            )
            .join(
                UserWordProgress,
                and_(
                    UserWordProgress.word_id == DeckWord.word_id,
                    UserWordProgress.user_id.in_(users),
                ),
            )
            .where(DeckWord.deck_id.in_(deck_ids))
            .group_by(DeckWord.deck_id, UserWordProgress.user_id)
        ).tuples()
    }


def board_assignments(
    db: Session,
    group_id: UUID,
    me: GroupMember,
    members: Sequence[GroupMember],
    today: date,
    zone: ZoneInfo,
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
    counts: dict[tuple[str, UUID], int] = {
        (deck_id, user_id): int(met)
        for deck_id, user_id, met in db.execute(
            select(DeckWord.deck_id, UserWordProgress.user_id, func.count())
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
        each = {member.user_id: counts.get((deck.id, member.user_id), 0) for member in members}
        due_on = assignment.due_on
        given_on = local_date(assignment.assigned_at, zone)
        return AssignmentOut(
            deck_id=deck.id,
            title=deck.title,
            due_on=due_on,
            my_standing=standing(each[me.user_id], size, given_on, due_on, today)
            if due_on is not None
            else None,
            author=nicknames.get(deck.owner_id) if deck.owner_id else None,
            is_mine=deck.owner_id == me.user_id,
            word_count=size,
            assigned_at=assignment.assigned_at,
            mine=each[me.user_id],
            group=GroupProgressOut(
                met=sum(min(met, size) for met in each.values()),
                total=size * len(members),
                finished=sum(1 for met in each.values() if size and met >= size),
                learners=len(members),
            ),
        )

    return [out(assignment, deck) for assignment, deck in given]
