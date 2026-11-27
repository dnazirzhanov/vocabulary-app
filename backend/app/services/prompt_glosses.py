"""Tap a word in a question (ADR 0091): the meanings of a Writing or Speaking question's words,
or of a shadowing exercise's sentence (ADR 0099), as Reading gives an article's. Made by the same
model and rules as a learner's own text (`readings.write_meanings`), once per question (or
sentence) and card language, then kept for everyone who may see it. Only what the app holds is
glossed: its own questions, and sentences of exercises the learner may open (each at most 300
characters, at most 200 to an exercise, 50 exercises to a learner). It is not a translator for any
text."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import GlossaryForm, PromptGlossary, ShadowingExercise, User
from app.services.generation import Provider
from app.services.readings import _entry, forms_of
from app.services.speaking import questions as speaking_bank
from app.services.writing import questions as writing_bank

KINDS = ("writing", "speaking", "shadowing")


def _sentence(db: Session, user: User, ref: str) -> str | None:
    """A shadowing exercise's sentence, `<exercise id>.<index>`, if this learner may open it.
    One sentence at a time: a transcript may run ten minutes, too long to gloss in one wait."""
    from app.services.shadowing import youtube

    exercise_id, _, index = ref.partition(".")
    try:
        exercise = db.get(ShadowingExercise, uuid.UUID(exercise_id))
        at = int(index)
    except ValueError:
        return None
    if exercise is None or not exercise.is_active or not youtube.may_open(db, user, exercise):
        return None
    sentences = exercise.sentences or []
    if not 0 <= at < len(sentences):
        return None
    text = str(sentences[at].get("text") or "")
    return text or None


def prompt_text(
    kind: str, question_id: str, db: Session | None = None, user: User | None = None
) -> str:
    """The question's words as the learner sees them; 404 for anything else."""
    if kind == "shadowing" and db is not None and user is not None:
        sentence = _sentence(db, user, question_id)
        if sentence:
            return sentence
    elif kind == "writing":
        found = writing_bank.get(question_id)
        if found:
            return found.title
    elif kind == "speaking":
        spoken = speaking_bank.by_id(question_id)
        if spoken:
            return "\n\n".join(part for part in (spoken.text, spoken.reference_text) if part)
    raise ApiError(404, "question_not_found", "No such question")


def glossary(
    db: Session,
    kind: str,
    question_id: str,
    language: str,
    provider: Provider,
    now: datetime,
    user: User | None = None,
) -> dict[str, Any]:
    text = prompt_text(kind, question_id, db, user)
    kept = db.get(PromptGlossary, (kind, question_id, language))
    if kept is not None and kept.text == text:
        return kept.glossary
    forms = forms_of([text])
    answer = provider.gloss(text, forms, language)
    made: dict[str, Any] = {}
    for form, gloss in answer.forms.items():
        key = form.lower()
        if key in forms and gloss.meaning.strip():
            entry = _entry(gloss)
            entry["l"] = entry["l"] or key
            made[key] = entry
    # A word the model left out: the course's own glossary, in Russian, as Reading does.
    missing = [form for form in forms if form not in made]
    if missing and language == "ru":
        for row in db.scalars(select(GlossaryForm).where(GlossaryForm.form.in_(missing))):
            made[row.form] = {"l": row.lemma or row.form, "p": "other", "t": row.ru, "d": None}
    if kept is None:
        kept = PromptGlossary(kind=kind, question_id=question_id, language=language)
        db.add(kept)
    kept.text = text
    kept.glossary = made
    kept.created_at = now
    db.commit()
    return made
