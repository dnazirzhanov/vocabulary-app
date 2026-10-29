"""The deck's word list with the learner's status on each word. Nothing is hidden: learners may
browse every word, met or not (product decision, M7)."""

from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DeckWord, User, UserWordProgress, Word
from app.schemas.learning import DeckWordOut, WordOut
from app.services.scheduling import WELL_LEARNED_STAGE

Status = Literal["not_started", "new", "learning", "well_learned"]


def _status(progress: UserWordProgress | None) -> Status:
    if progress is None:
        return "not_started"
    if progress.stage >= WELL_LEARNED_STAGE:
        return "well_learned"
    return "new" if progress.review_count == 0 else "learning"


def deck_words(db: Session, user: User, deck_id: str) -> list[DeckWordOut]:
    rows = db.execute(
        select(DeckWord.position, Word, UserWordProgress)
        .join(Word, Word.id == DeckWord.word_id)
        .outerjoin(
            UserWordProgress,
            (UserWordProgress.word_id == Word.id) & (UserWordProgress.user_id == user.id),
        )
        .where(DeckWord.deck_id == deck_id)
        .order_by(DeckWord.position)
    )
    return [
        DeckWordOut(
            position=position,
            word=WordOut(
                id=word.id,
                headword=word.headword,
                pos=word.pos,
                translation=word.translation,
                example=word.example,
                example_ru=word.example_ru,
                illustration=word.illustration,
            ),
            status=_status(progress),
            next_review_at=progress.due_at if progress else None,
        )
        for position, word, progress in rows
    ]
