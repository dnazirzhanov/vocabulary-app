"""Tap a word in a question (ADR 0091): the meanings of a Writing or Speaking question's words,
as Reading gives an article's. Made by the same model and rules as a learner's own text
(`readings.write_meanings`), once per question and card language, then kept: the questions are
the app's own, so after the first learner every tap is instant. Only known questions are glossed:
this is not a translator for any text."""

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import GlossaryForm, PromptGlossary
from app.services.generation import Provider
from app.services.readings import _entry, forms_of
from app.services.speaking import questions as speaking_bank
from app.services.writing import questions as writing_bank

KINDS = ("writing", "speaking")


def prompt_text(kind: str, question_id: str) -> str:
    """The question's words as the learner sees them; 404 for anything else."""
    if kind == "writing":
        found = writing_bank.get(question_id)
        if found:
            return found.title
    elif kind == "speaking":
        spoken = speaking_bank.by_id(question_id)
        if spoken:
            return "\n\n".join(part for part in (spoken.text, spoken.reference_text) if part)
    raise ApiError(404, "question_not_found", "No such question")


def glossary(
    db: Session, kind: str, question_id: str, language: str, provider: Provider, now: datetime
) -> dict[str, Any]:
    text = prompt_text(kind, question_id)
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
