"""The deck's word list with the learner's status on each word. Nothing is hidden: learners may
browse every word, met or not (product decision, M7)."""

from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DeckWord, GlossaryForm, User, UserWordProgress, Word
from app.schemas.learning import DeckWordOut, GlossaryEntryOut, WordOut
from app.services.scheduling import LEARNING, is_well_learned

Status = Literal["not_started", "new", "learning", "well_learned"]


def _status(progress: UserWordProgress | None) -> Status:
    if progress is None:
        return "not_started"
    if is_well_learned(progress.fsrs_state, progress.stability):
        return "well_learned"
    # Still in its first learning steps (Anki's "learning" cards): just met.
    return "new" if progress.fsrs_state == LEARNING and progress.lapses == 0 else "learning"


def deck_words(db: Session, user: User, deck_id: str) -> list[DeckWordOut]:
    rows = db.execute(
        select(Word, UserWordProgress)
        .select_from(DeckWord)
        .join(Word, Word.id == DeckWord.word_id)
        .outerjoin(
            UserWordProgress,
            (UserWordProgress.word_id == Word.id) & (UserWordProgress.user_id == user.id),
        )
        .where(DeckWord.deck_id == deck_id)
        .order_by(DeckWord.position)
    )
    # Numbered as they stand: stored positions are only an order, and removing a word leaves a gap.
    return [
        DeckWordOut(
            position=number,
            word=WordOut(
                id=word.id,
                headword=word.headword,
                pos=word.pos,
                translation=word.translation,
                example=word.example,
                example_translation=word.example_translation,
                language=word.language,
                illustration=word.illustration,
            ),
            status=_status(progress),
            next_review_at=progress.due_at if progress else None,
        )
        for number, (word, progress) in enumerate(rows)
    ]


def glossary(db: Session) -> dict[str, GlossaryEntryOut]:
    return {
        row.form: GlossaryEntryOut(ru=row.ru, lemma=row.lemma, note=row.note)
        for row in db.scalars(select(GlossaryForm).order_by(GlossaryForm.form))
    }
