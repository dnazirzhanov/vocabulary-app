"""One voice for every word (ADR 0070): words and examples the app has no recording of (a teacher's
own cards) are spoken once by Azure's neural voice, kept in storage and the `pronunciation_audio`
table, and served to everyone from then on, so the whole class hears the same thing.

The same Azure Speech resource as Speaking's pronunciation assessment. A new text costs one call;
a known one costs nothing. New texts are capped per learner per day."""

import hashlib
import re
from typing import Literal
from xml.sax.saxutils import escape

from fastapi.concurrency import run_in_threadpool
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.ratelimit import limit_new_pronunciations
from app.models import PronunciationAudio, User
from app.services.speaking.storage import get_storage

VOICE = "en-US-AvaNeural"
OUTPUT = "audio-24khz-48kbitrate-mono-mp3"
MEDIA_TYPE = "audio/mpeg"
Kind = Literal["word", "example"]
MAX_CHARS: dict[str, int] = {"word": 64, "example": 300}
# English text as cards hold it: letters, digits, spaces and ordinary punctuation; nothing else.
_SPEAKABLE = re.compile(r"[A-Za-z0-9 '’\-.,!?;:()\"“”]+")


def clean(kind: Kind, text: str) -> str:
    """The text as it will be spoken and cached, or a 422 if it is not a card's English."""
    spoken = " ".join(text.split())
    if not spoken or len(spoken) > MAX_CHARS[kind] or not _SPEAKABLE.fullmatch(spoken):
        raise ApiError(422, "bad_text", "Only a card's English word or example can be spoken")
    if not re.search(r"[A-Za-z]", spoken):
        raise ApiError(422, "bad_text", "Only a card's English word or example can be spoken")
    return spoken


def cache_key(kind: Kind, text: str) -> str:
    return hashlib.sha256(f"{VOICE}|{kind}|{text}".encode()).hexdigest()


def synthesize(text: str, settings: Settings) -> bytes:
    """One call to Azure's text-to-speech; raises ApiError(502) on any failure."""
    import httpx2 as httpx

    if settings.azure_speech_key is None:
        raise ApiError(503, "tts_unavailable", "The voice is not set up")
    ssml = (
        "<speak version='1.0' xml:lang='en-US'>"
        f"<voice name='{VOICE}'>{escape(text)}</voice></speak>"
    )
    try:
        response = httpx.post(
            f"https://{settings.azure_speech_region}.tts.speech.microsoft.com/cognitiveservices/v1",
            content=ssml.encode(),
            headers={
                "Ocp-Apim-Subscription-Key": settings.azure_speech_key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": OUTPUT,
                "User-Agent": "slovar",
            },
            timeout=20.0,
        )
    except Exception as exc:
        raise ApiError(502, "tts_failed", "The voice could not be reached") from exc
    if response.status_code >= 400 or not response.content:
        raise ApiError(502, "tts_failed", f"The voice failed ({response.status_code})")
    return bytes(response.content)


async def audio_for(db: Session, user: User, kind: Kind, text: str, settings: Settings) -> bytes:
    """The recording of `text`: from the cache, or made now, kept, and counted against the
    learner's daily allowance."""
    spoken = clean(kind, text)
    key = cache_key(kind, spoken)
    storage = get_storage(settings)
    row = db.get(PronunciationAudio, key)
    if row is not None:
        return storage.download_sync(row.storage_path)

    limit_new_pronunciations(user.id, settings)
    data = await run_in_threadpool(synthesize, spoken, settings)
    path = f"pronunciation/{key}.mp3"
    await storage.upload(path, data, MEDIA_TYPE)
    db.add(
        PronunciationAudio(
            key=key,
            voice=VOICE,
            kind=kind,
            text=spoken,
            storage_path=path,
            byte_size=len(data),
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # two learners asked at once: the same file, already recorded
    return data
