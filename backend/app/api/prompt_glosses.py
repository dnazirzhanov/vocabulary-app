"""Tap a word in a Writing or Speaking question (ADR 0091), or a shadowing sentence (ADR 0099)."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends

from app.api.decks import get_provider
from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.services import prompt_glosses
from app.services.generation import Provider

router = APIRouter(tags=["glossary"])

Drafting = Annotated[Provider, Depends(get_provider)]


@router.get("/prompt-glossary/{kind}/{question_id}")
def prompt_glossary(
    kind: Literal["writing", "speaking", "shadowing"],
    question_id: str,
    user: CurrentUser,
    db: DbSession,
    now: Now,
    provider: Drafting,
) -> dict[str, Any]:
    """Each word of the question with its meaning in the learner's card language."""
    language = user.language or "ru"
    return {
        "glossary": prompt_glosses.glossary(db, kind, question_id, language, provider, now, user)
    }
