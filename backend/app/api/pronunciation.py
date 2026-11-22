"""How a card's word or example sounds, in the app's one voice (ADR 0070)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.core.auth import CurrentUser, DbSession
from app.core.config import Settings, get_settings
from app.services.speech import tts

router = APIRouter(tags=["pronunciation"])


@router.get("/pronunciation", response_class=Response)
async def pronunciation(
    user: CurrentUser,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    kind: tts.Kind,
    text: Annotated[str, Query(min_length=1, max_length=400)],
) -> Response:
    """The MP3 of `text`: the same text is the same file for everyone, so it is cached for good."""
    data = await tts.audio_for(db, user, kind, text, settings)
    return Response(
        content=data,
        media_type=tts.MEDIA_TYPE,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
