"""One voice for every word (ADR 0070): a word without a recording is spoken once by the voice,
kept, and served to everyone after that. Azure is never called: `tts.synthesize` is replaced."""

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.models import PronunciationAudio
from app.services.speech import tts


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name}


class Voice:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.spoken: list[str] = []
        self.fail = False
        monkeypatch.setattr(tts, "synthesize", self.synthesize)

    def synthesize(self, text: str, settings: Settings) -> bytes:
        self.spoken.append(text)
        if self.fail:
            raise ApiError(502, "tts_failed", "The voice failed (500)")
        return b"ID3" + text.encode()


@pytest.fixture
def voice(monkeypatch: pytest.MonkeyPatch) -> Voice:
    monkeypatch.setattr(get_settings(), "speaking_storage_mode", "filesystem")
    monkeypatch.setattr(get_settings(), "speaking_audio_dir", tempfile.mkdtemp(prefix="tts-test-"))
    return Voice(monkeypatch)


def speak(client: TestClient, text: str, kind: str = "word", who: str = "ann") -> Response:
    return client.get("/api/pronunciation", params={"kind": kind, "text": text}, headers=as_(who))


def test_a_word_is_spoken_once_and_then_everyone_hears_the_same_file(
    client: TestClient, voice: Voice, db: Session
) -> None:
    first = speak(client, "  well-known ", who="ann")
    assert first.status_code == 200, first.text
    assert first.headers["content-type"] == "audio/mpeg"
    assert "max-age=31536000" in first.headers["cache-control"]
    assert first.content == b"ID3well-known"

    # Another learner, another day: the same file, and no second call to the voice.
    again = speak(client, "well-known", who="bob")
    assert again.content == first.content
    assert voice.spoken == ["well-known"]

    row = db.scalars(select(PronunciationAudio)).one()
    assert (row.voice, row.kind, row.text) == (tts.VOICE, "word", "well-known")
    stored = Path(get_settings().speaking_audio_dir) / row.storage_path
    assert stored.read_bytes() == first.content


def test_a_word_and_an_example_are_kept_apart(client: TestClient, voice: Voice) -> None:
    speak(client, "harvest")
    speak(client, "The harvest was late this year.", kind="example")
    assert voice.spoken == ["harvest", "The harvest was late this year."]


@pytest.mark.parametrize(
    ("kind", "text"),
    [
        ("word", "x" * 65),  # longer than any card's word
        ("example", "word " * 70),
        ("word", "<speak>hi</speak>"),
        ("word", "привет"),
        ("word", "123"),
        ("song", "harvest"),
    ],
)
def test_only_a_cards_english_is_spoken(
    client: TestClient, voice: Voice, kind: str, text: str
) -> None:
    assert speak(client, text, kind=kind).status_code == 422
    assert voice.spoken == []


def test_a_failed_voice_keeps_nothing_and_can_be_tried_again(
    client: TestClient, voice: Voice, db: Session
) -> None:
    voice.fail = True
    assert speak(client, "lantern").status_code == 502
    assert db.get(PronunciationAudio, tts.cache_key("word", "lantern")) is None
    voice.fail = False
    assert speak(client, "lantern").status_code == 200


def test_new_words_are_capped_per_day_but_known_ones_never(
    client: TestClient, voice: Voice, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "pronunciations_per_day", 2)
    who = "capped-learner"
    assert speak(client, "meadow", who=who).status_code == 200
    assert speak(client, "orchard", who=who).status_code == 200
    refused = speak(client, "pebble", who=who)
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "pronunciation_limit"
    assert speak(client, "meadow", who=who).status_code == 200  # already made: free
