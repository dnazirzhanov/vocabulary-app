"""A YouTube video's captions fetched by the server (ADR 0100): the channel's own English first,
then YouTube's speech recognition, never a translation; each video fetched once for everyone; a
video without captions tried again only after an hour; YouTube itself is never asked in tests."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.ratelimit import reset_limits
from app.main import create_app
from app.services.shadowing import captions
from tests.support import at

MOMENT = datetime(2026, 11, 27, 10, 0, tzinfo=UTC)
VIDEO = "AM7yJbiS3eI"
CUES = [
    {"start_ms": 120, "end_ms": 10680, "text": "Time feels the same every day."},
    {"start_ms": 10680, "end_ms": 20510, "text": "But Einstein discovered something surprising."},
]


def as_(name: str, moment: datetime = MOMENT) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


Found = tuple[str, list[dict[str, Any]]] | None


class FakeYouTube:
    def __init__(self, answer: Found | Exception) -> None:
        self.answer = answer
        self.asked: list[str] = []

    def __call__(self, video_id: str) -> Found:
        self.asked.append(video_id)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def youtube(monkeypatch: pytest.MonkeyPatch) -> FakeYouTube:
    fake = FakeYouTube(("manual", CUES))
    monkeypatch.setattr(captions, "download", fake)
    return fake


def ask(client: TestClient, who: str = "ann", moment: datetime = MOMENT, video: str = VIDEO) -> Any:
    return client.post(
        "/api/shadowing/youtube/transcript", json={"youtube_id": video}, headers=as_(who, moment)
    )


def test_captions_are_fetched_once_and_kept_for_everyone(
    client: TestClient, youtube: FakeYouTube
) -> None:
    first = ask(client, "ann")
    assert first.status_code == 200
    assert first.json() == {"kind": "manual", "cues": CUES}
    again = ask(client, "ben", MOMENT + timedelta(days=30))
    assert again.json() == first.json()
    assert youtube.asked == [VIDEO]


def test_a_video_without_captions_is_tried_again_only_after_an_hour(
    client: TestClient, youtube: FakeYouTube
) -> None:
    youtube.answer = None
    missing = ask(client)
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "no_captions")
    assert ask(client, "ben", MOMENT + timedelta(minutes=59)).status_code == 404
    assert youtube.asked == [VIDEO]
    youtube.answer = ("auto", CUES)
    later = ask(client, "ben", MOMENT + timedelta(minutes=61))
    assert (later.status_code, later.json()["kind"]) == (200, "auto")
    assert youtube.asked == [VIDEO, VIDEO]


def test_youtube_refusing_means_paste_it(client: TestClient, youtube: FakeYouTube) -> None:
    youtube.answer = RuntimeError("Sign in to confirm you're not a bot")
    refused = ask(client)
    assert (refused.status_code, refused.json()["error"]["code"]) == (404, "no_captions")


def test_only_a_video_id_is_fetched(client: TestClient, youtube: FakeYouTube) -> None:
    assert ask(client, video="../../etc").status_code == 422
    assert youtube.asked == []


def test_with_fetching_off_only_kept_captions_are_given(db: Session, youtube: FakeYouTube) -> None:
    reset_limits()
    settings = Settings(
        environment="test",
        database_url=get_settings().database_url,
        youtube_captions=False,
        youtube_captions_per_hour=2,
        _env_file=None,
    )
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        assert ask(client).status_code == 404
        assert youtube.asked == []
        assert ask(client).status_code == 404
        limited = ask(client)
        assert (limited.status_code, limited.json()["error"]["code"]) == (429, "captions_limit")


def test_the_channels_own_english_comes_first() -> None:
    info = {
        "language": "en",
        "subtitles": {
            "en-GB": [{"ext": "json3", "url": "own"}],
            "ru": [{"ext": "json3", "url": "russian"}],
        },
        "automatic_captions": {
            "en-orig": [{"ext": "json3", "url": "recognised"}],
            "en": [{"ext": "json3", "url": "recognised"}],
        },
    }
    assert captions.pick_track(info) == ("manual", [{"ext": "json3", "url": "own"}])


def test_speech_recognition_is_taken_but_never_a_translation() -> None:
    english = {
        "language": "en",
        "automatic_captions": {"en": [{"ext": "json3", "url": "recognised"}]},
    }
    assert captions.pick_track(english) == ("auto", [{"ext": "json3", "url": "recognised"}])
    original = {
        "automatic_captions": {
            "en-orig": [{"ext": "json3", "url": "recognised"}],
            "en": [{"ext": "json3", "url": "translated"}],
        }
    }
    assert captions.pick_track(original) == ("auto", [{"ext": "json3", "url": "recognised"}])
    russian = {
        "language": "ru",
        "automatic_captions": {
            "en": [{"ext": "json3", "url": "translated"}],
            "ru": [{"ext": "json3", "url": "asr"}],
        },
    }
    assert captions.pick_track(russian) is None


def test_rolling_automatic_captions_become_each_line_once() -> None:
    # As YouTube's json3 speech recognition comes: a window event, lines whose time overlaps the
    # next one's, and «\n» events that only roll the window.
    data = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 2290196, "id": 1},
            {
                "tStartMs": 0,
                "dDurationMs": 7320,
                "segs": [{"utf8": "Time"}, {"utf8": " feels", "tOffsetMs": 680}],
            },
            {"tStartMs": 4550, "dDurationMs": 2770, "aAppend": 1, "segs": [{"utf8": "\n"}]},
            {
                "tStartMs": 4560,
                "dDurationMs": 6720,
                "segs": [{"utf8": "[Music] 24"}, {"utf8": " hours ♪"}],
            },
            {"tStartMs": 9000, "dDurationMs": 500, "segs": [{"utf8": "[Applause]"}]},
        ]
    }
    assert captions.cues_of(data) == [
        {"start_ms": 0, "end_ms": 4560, "text": "Time feels"},
        {"start_ms": 4560, "end_ms": 11280, "text": "24 hours"},
    ]
