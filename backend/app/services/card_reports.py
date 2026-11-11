"""A learner says a card is wrong. A course card's reports are read by the content editors (the
owner, `CONTENT_EDITORS`); a deck's own card's by the deck's author, who corrects it in the
editor. A report stays open until the card is corrected or the report is marked done."""

from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models import CardReport, Deck, DeckWord, User, Word
from app.schemas.card_reports import CardReportsOut, ReportedCardOut, ReportReason
from app.services import decks

# More than this many in a day is not someone reading cards carefully.
MAX_REPORTS_A_DAY = 30
# The notes shown with a card: the latest few are enough to see what is wrong.
NOTES_SHOWN = 5


def is_editor(user: User) -> bool:
    """Named by the sign-in's id as Supabase shows it (its UID), or as stored (`supabase|<UID>`)."""
    editors = {subject.strip() for subject in get_settings().content_editors.split(",")} - {""}
    bare = user.auth_subject.split("|", 1)[-1]
    return user.auth_subject in editors or bare in editors


def report(
    db: Session,
    user: User,
    deck_id: str,
    word_id: str,
    reason: ReportReason,
    note: str | None,
    at: datetime,
) -> None:
    """A card of a deck I study; reported again, the open report takes the new reason and note.
    The caller commits."""
    deck = decks.visible_deck(db, user, deck_id)
    in_deck = db.scalar(
        select(DeckWord.word_id).where(DeckWord.deck_id == deck.id, DeckWord.word_id == word_id)
    )
    if in_deck is None:
        raise ApiError(404, "word_not_found", "Word not found")
    note = " ".join(note.split()) if note else None
    kept = db.scalar(
        select(CardReport).where(
            CardReport.user_id == user.id,
            CardReport.word_id == word_id,
            CardReport.resolved_at.is_(None),
        )
    )
    if kept is not None:
        kept.reason, kept.note = reason, note or kept.note
        db.flush()
        return
    sent = db.scalar(
        select(func.count())
        .select_from(CardReport)
        .where(CardReport.user_id == user.id, CardReport.created_at > at - timedelta(days=1))
    )
    if (sent or 0) >= MAX_REPORTS_A_DAY:
        raise ApiError(429, "too_many_reports", "Too many reports today")
    db.add(CardReport(user_id=user.id, word_id=word_id, reason=reason, note=note, created_at=at))
    db.flush()


def _listed(db: Session, words: list[Word]) -> CardReportsOut:
    if not words:
        return CardReportsOut(cards=[])
    rows = db.execute(
        select(CardReport)
        .where(
            CardReport.word_id.in_([word.id for word in words]), CardReport.resolved_at.is_(None)
        )
        .order_by(CardReport.created_at.desc())
    ).scalars()
    by_word: dict[str, list[CardReport]] = defaultdict(list)
    for row in rows:
        by_word[row.word_id].append(row)
    cards = [
        ReportedCardOut(
            word_id=word.id,
            headword=word.headword,
            translation=word.translation,
            example=word.example,
            translation_wrong=sum(r.reason == "translation" for r in by_word[word.id]),
            example_wrong=sum(r.reason == "example" for r in by_word[word.id]),
            other=sum(r.reason == "other" for r in by_word[word.id]),
            notes=[r.note for r in by_word[word.id] if r.note][:NOTES_SHOWN],
            last_at=by_word[word.id][0].created_at,
        )
        for word in words
        if by_word[word.id]
    ]
    return CardReportsOut(cards=sorted(cards, key=lambda card: card.last_at, reverse=True))


def course_reports(db: Session, user: User) -> CardReportsOut:
    """Every open report, on any card (the course's and every deck's), for the content editors: they
    are how the cards, and the AI that drafts them, get better. A deck's author still sees their own."""
    if not is_editor(user):
        raise ApiError(403, "not_allowed", "Only the content editors read these")
    words = db.scalars(
        select(Word)
        .join(CardReport, CardReport.word_id == Word.id)
        .where(CardReport.resolved_at.is_(None))
        .distinct()
    ).all()
    return _listed(db, list(words))


def deck_reports(db: Session, user: User, deck_id: str) -> CardReportsOut:
    """Open reports on the cards of a deck I wrote."""
    deck = db.scalar(select(Deck).where(Deck.id == deck_id, Deck.owner_id == user.id))
    if deck is None:
        raise ApiError(404, "deck_not_found", "Deck not found")
    words = db.scalars(select(Word).where(Word.owner_deck_id == deck.id)).all()
    return _listed(db, list(words))


def resolve(db: Session, user: User, word_id: str, now: datetime) -> None:
    """Marked done by whoever reads the card's reports: a content editor, or the deck's author."""
    word = db.get(Word, word_id)
    if word is None:
        raise ApiError(404, "word_not_found", "Word not found")
    author = (
        db.scalar(select(Deck.owner_id).where(Deck.id == word.owner_deck_id))
        if word.owner_deck_id
        else None
    )
    allowed = is_editor(user) or (word.owner_deck_id is not None and author == user.id)
    if not allowed:
        raise ApiError(404, "word_not_found", "Word not found")
    resolved(db, word_id, now)
    db.commit()


def resolved(db: Session, word_id: str, now: datetime) -> None:
    """The card was corrected: its open reports are done. The caller commits."""
    db.execute(
        update(CardReport)
        .where(CardReport.word_id == word_id, CardReport.resolved_at.is_(None))
        .values(resolved_at=now)
    )
