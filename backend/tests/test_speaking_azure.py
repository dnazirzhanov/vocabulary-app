"""Azure Pronunciation Assessment: what we send, and how we read what comes back.

Everything here follows Microsoft Learn, "Speech to text REST API for short audio": WAV PCM 16 kHz
mono (or OGG Opus) only; at most 30 s of audio for pronunciation assessment; scores flat on the
NBest item and on each word; offsets in 100-ns units. Azure itself is replaced by a fake that
records each request, so these tests cost nothing.
"""

import base64
import io
import itertools
import json
import wave
from collections.abc import Callable
from typing import Any

import pytest

from app.services.speaking import audio as audio_mod
from app.services.speaking import pronunciation as pa
from app.services.speaking.audio import AudioConversionError, plan_pieces, to_wav_16k_mono
from app.services.speaking.fluency import compute_fluency, is_filler
from app.services.speaking.pronunciation import PronunciationError
from app.services.speaking.transcription import TranscriptWord
from tests.speaking_audio import real_mp4, real_webm

# ── A response as the REST page's pronunciation sample lays it out: scores flat on NBest[0]. ──


def _rest_response(
    words: list[str], *, accuracy: float = 90.0, prosody: float = 80.0
) -> dict[str, Any]:
    return {
        "RecognitionStatus": "Success",
        "Offset": 700000,
        "Duration": 8400000,
        "DisplayText": " ".join(words),
        "SNR": 38.4,
        "NBest": [
            {
                "Confidence": 0.98,
                "Lexical": " ".join(words).lower(),
                "Display": " ".join(words),
                "AccuracyScore": accuracy,
                "FluencyScore": 95.0,
                "ProsodyScore": prosody,
                "CompletenessScore": 100.0,
                "PronScore": 88.5,
                "Words": [
                    {
                        "Word": w.lower(),
                        "Offset": 700000 + i * 3000000,
                        "Duration": 2600000,
                        "AccuracyScore": 60.0 if w == "weather" else 100.0,
                        "ErrorType": "Mispronunciation" if w == "weather" else "None",
                    }
                    for i, w in enumerate(words)
                ],
            }
        ],
    }


class FakeAzure:
    """Stands in for httpx2.post; keeps every request, answers with the given bodies in turn."""

    def __init__(self, *bodies: dict[str, Any], status: int = 200) -> None:
        self.bodies = list(bodies)
        self.status = status
        self.requests: list[dict[str, Any]] = []

    def __call__(
        self, url: str, *, content: bytes, headers: dict[str, str], timeout: float
    ) -> "_Response":
        params = json.loads(base64.b64decode(headers["Pronunciation-Assessment"]))
        self.requests.append({"url": url, "body": content, "headers": headers, "params": params})
        body = self.bodies.pop(0) if len(self.bodies) > 1 else self.bodies[0]
        return _Response(self.status, body)


class _Response:
    def __init__(self, status: int, body: dict[str, Any]) -> None:
        self.status_code = status
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


@pytest.fixture
def azure(monkeypatch: pytest.MonkeyPatch) -> Callable[..., FakeAzure]:
    def install(*bodies: dict[str, Any], status: int = 200) -> FakeAzure:
        fake = FakeAzure(*bodies, status=status)
        import httpx2

        monkeypatch.setattr(httpx2, "post", fake)
        return fake

    return install


def _wav_info(wav: bytes) -> tuple[int, int, int, int]:
    with wave.open(io.BytesIO(wav), "rb") as w:
        return w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()


def _silence_wav(ms: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(b"\x00\x00" * (16 * ms))
    return out.getvalue()


# ── Conversion ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("recording", [real_webm, real_mp4], ids=["chrome-webm", "safari-mp4"])
def test_browser_recordings_become_wav_16k_mono(recording) -> None:  # type: ignore[no-untyped-def]
    wav = to_wav_16k_mono(recording(2.0))
    channels, width, rate, frames = _wav_info(wav)
    assert (channels, width, rate) == (1, 2, 16_000)
    assert abs(frames / rate - 2.0) < 0.1
    assert audio_mod.duration_ms(wav) == pytest.approx(2000, abs=100)


def test_unreadable_audio_is_a_conversion_error_not_a_crash() -> None:
    with pytest.raises(AudioConversionError) as exc:
        to_wav_16k_mono(b"\x1a\x45\xdf\xa3" + b"\x00" * 128)
    assert exc.value.code == "unreadable"


def test_slice_keeps_the_format_and_the_length_asked_for() -> None:
    wav = _silence_wav(10_000)
    part = audio_mod.slice_wav(wav, 2_000, 5_500)
    assert _wav_info(part)[:3] == (1, 2, 16_000)
    assert audio_mod.duration_ms(part) == 3_500


# ── Read aloud ───────────────────────────────────────────────────────────────────


SENTENCE = "The weather in November is cold and rainy."


def test_read_aloud_sends_wav_with_the_documented_settings(azure) -> None:  # type: ignore[no-untyped-def]
    """The request Azure gets: WAV body and Content-Type, the sentence, miscue and prosody on."""
    fake = azure(_rest_response(SENTENCE.rstrip(".").split()))
    pa.assess_read_aloud(to_wav_16k_mono(real_webm(2.0)), SENTENCE, "key", "westeurope")

    [req] = fake.requests
    assert req["url"].startswith("https://westeurope.stt.speech.microsoft.com/")
    assert req["headers"]["Content-Type"] == "audio/wav; codecs=audio/pcm; samplerate=16000"
    assert req["body"][:4] == b"RIFF"
    assert _wav_info(req["body"])[:3] == (1, 2, 16_000)
    assert req["params"] == {
        "ReferenceText": SENTENCE,
        "GradingSystem": "HundredMark",
        "Granularity": "Phoneme",
        "Dimension": "Comprehensive",
        "EnableMiscue": "True",
        "EnableProsodyAssessment": "True",
    }


def test_scores_are_read_from_the_rest_shape(azure) -> None:  # type: ignore[no-untyped-def]
    """The REST API puts scores directly on NBest[0] and on each word; they must not read as 0."""
    azure(_rest_response(SENTENCE.rstrip(".").split(), accuracy=91.0, prosody=77.0))
    result = pa.assess_read_aloud(_silence_wav(3_000), SENTENCE, "key")
    assert result.accuracy_score == 91.0
    assert result.prosody_score == 77.0
    assert result.pronunciation_score == 88.5
    assert result.completeness_score == 100.0
    weather = next(w for w in result.words if w.word == "weather")
    assert (weather.accuracy_score, weather.error_type) == (60.0, "Mispronunciation")
    assert result.raw["mode"] == "read_aloud"


def test_scores_are_read_from_the_sdk_shape_too(azure) -> None:  # type: ignore[no-untyped-def]
    """The Speech SDK's JSON nests them in PronunciationAssessment; both are understood."""
    azure(
        {
            "RecognitionStatus": "Success",
            "NBest": [
                {
                    "PronunciationAssessment": {
                        "AccuracyScore": 70.0,
                        "FluencyScore": 60.0,
                        "CompletenessScore": 90.0,
                        "PronScore": 68.0,
                    },
                    "Words": [
                        {
                            "Word": "cold",
                            "PronunciationAssessment": {"AccuracyScore": 55.0, "ErrorType": "None"},
                            "Phonemes": [
                                {"Phoneme": "k", "PronunciationAssessment": {"AccuracyScore": 40.0}}
                            ],
                        }
                    ],
                }
            ],
        }
    )
    result = pa.assess_read_aloud(_silence_wav(2_000), "cold", "key")
    assert (result.accuracy_score, result.pronunciation_score, result.prosody_score) == (
        70.0,
        68.0,
        None,
    )
    assert result.words[0].accuracy_score == 55.0
    assert result.words[0].phonemes[0].accuracy_score == 40.0


def test_read_aloud_longer_than_azure_allows_is_cut_to_30_seconds(azure) -> None:  # type: ignore[no-untyped-def]
    fake = azure(_rest_response(["cold"]))
    pa.assess_read_aloud(_silence_wav(45_000), "cold", "key")
    assert audio_mod.duration_ms(fake.requests[0]["body"]) <= 30_000


@pytest.mark.parametrize("status", ["NoMatch", "InitialSilenceTimeout"])
def test_silence_is_no_speech_not_a_low_score(azure, status: str) -> None:  # type: ignore[no-untyped-def]
    azure({"RecognitionStatus": status})
    with pytest.raises(PronunciationError) as exc:
        pa.assess_read_aloud(_silence_wav(2_000), SENTENCE, "key")
    assert exc.value.code == "no_speech"


def test_a_rejected_key_is_reported_as_such(azure) -> None:  # type: ignore[no-untyped-def]
    azure({}, status=401)
    with pytest.raises(PronunciationError) as exc:
        pa.assess_read_aloud(_silence_wav(2_000), SENTENCE, "key")
    assert exc.value.code == "auth_failed"


# ── Free speech ──────────────────────────────────────────────────────────────────


def _speech(
    n: int, *, every_ms: int = 400, pauses: dict[int, int] | None = None
) -> list[TranscriptWord]:
    """n words, one every `every_ms`; `pauses` adds silence (ms) before word index k."""
    words, t = [], 0
    for i in range(n):
        t += (pauses or {}).get(i, 0)
        words.append(
            TranscriptWord(word=f"w{i}", start_ms=t, end_ms=t + every_ms - 80, confidence=1)
        )
        t += every_ms
    return words


def test_pieces_stay_under_30_seconds_and_cut_at_the_longest_pause() -> None:
    # 150 words over ~62 s, with clear pauses before words 50 and 100.
    words = _speech(150, pauses={50: 1_500, 100: 1_200})
    total = words[-1].end_ms + 500
    pieces = plan_pieces(words, total)
    assert all(p.end_ms - p.start_ms <= 28_000 for p in pieces)
    # Every word in exactly one piece, in order.
    assert pieces[0].first == 0 and pieces[-1].last == 150
    assert all(a.last == b.first for a, b in itertools.pairwise(pieces))
    # The cuts fall on the long pauses, not mid-phrase.
    assert {p.first for p in pieces[1:]} >= {50, 100}


def test_free_speech_is_assessed_piece_by_piece_against_its_own_words(azure) -> None:  # type: ignore[no-untyped-def]
    words = _speech(150, pauses={50: 1_500, 100: 1_200})
    total = words[-1].end_ms + 500
    pieces = plan_pieces(words, total)
    fake = azure(*[_rest_response([f"w{i}" for i in range(p.first, p.last)]) for p in pieces])

    result = pa.assess_free_speech(_silence_wav(total), words, total, "key")

    assert len(fake.requests) == len(pieces) >= 3
    for req, piece in zip(fake.requests, pieces, strict=True):
        assert audio_mod.duration_ms(req["body"]) <= 30_000
        assert req["params"]["ReferenceText"] == " ".join(
            f"w{i}" for i in range(piece.first, piece.last)
        )
        # The reference is the learner's own words: no omission/insertion marking.
        assert req["params"]["EnableMiscue"] == "False"
    assert len(result.words) == 150
    assert result.raw["mode"] == "free_speech"
    assert result.raw["pieces"] == len(pieces)


def test_pieces_are_combined_by_how_many_words_each_had(azure) -> None:  # type: ignore[no-untyped-def]
    words = _speech(90, pauses={30: 2_000})  # ~38 s: two pieces of unequal size
    total = words[-1].end_ms + 500
    pieces = plan_pieces(words, total)
    assert len(pieces) == 2
    sizes = [p.last - p.first for p in pieces]
    azure(_rest_response(["a"], accuracy=100.0), _rest_response(["b"], accuracy=50.0))
    result = pa.assess_free_speech(_silence_wav(total), words, total, "key")
    expected = (100.0 * sizes[0] + 50.0 * sizes[1]) / sum(sizes)
    assert result.accuracy_score == pytest.approx(expected, abs=0.1)


def test_fillers_are_not_part_of_what_azure_scores(azure) -> None:  # type: ignore[no-untyped-def]
    words = [
        TranscriptWord(word=w, start_ms=i * 400, end_ms=i * 400 + 300, confidence=1)
        for i, w in enumerate(["I", "um,", "like", "uh", "films"])
    ]
    fake = azure(_rest_response(["I", "like", "films"]))
    pa.assess_free_speech(_silence_wav(2_500), words, 2_500, "key")
    assert fake.requests[0]["params"]["ReferenceText"] == "I like films"


def test_a_silent_piece_is_left_out_not_scored_zero(azure) -> None:  # type: ignore[no-untyped-def]
    words = _speech(90, pauses={30: 2_000})
    total = words[-1].end_ms + 500
    azure({"RecognitionStatus": "NoMatch"}, _rest_response(["b"], accuracy=80.0))
    result = pa.assess_free_speech(_silence_wav(total), words, total, "key")
    assert result.accuracy_score == 80.0
    assert result.raw["pieces_scored"] == 1


# ── Fluency: hesitations ─────────────────────────────────────────────────────────


def test_filled_pauses_count_as_hesitation_not_as_speech() -> None:
    assert is_filler("Um,") and is_filler("uh…") and not is_filler("umbrella")
    plain = [TranscriptWord(f"w{i}", i * 500, i * 500 + 400, 1) for i in range(20)]
    hesitant = list(plain)
    # The same 20 words, with five "um"s taking time between them.
    for k in (3, 7, 11, 15, 18):
        hesitant.insert(k, TranscriptWord("um", plain[k].start_ms - 100, plain[k].start_ms - 10, 1))
    a = compute_fluency(plain, 10_000)
    b = compute_fluency(hesitant, 10_000)
    assert b.wpm == a.wpm  # fillers do not raise the speech rate
    assert b.raw["filler_count"] == 5
    assert b.pause_ratio > a.pause_ratio


def test_a_three_minute_answer_is_cut_into_pieces_azure_accepts() -> None:
    """Answers may now be 3 minutes long: every piece stays under Azure's 30 s limit."""
    words = _speech(450, every_ms=400, pauses={i: 700 for i in range(25, 450, 25)})
    total = words[-1].end_ms + 300
    assert total >= 180_000
    pieces = plan_pieces(words, total)
    assert all(p.end_ms - p.start_ms <= 28_000 for p in pieces)
    assert pieces[0].first == 0 and pieces[-1].last == 450
    assert len(pieces) >= 7


def test_word_times_are_kept_on_the_whole_recordings_clock(azure) -> None:  # type: ignore[no-untyped-def]
    """Azure's word offsets (100 ns units, per piece) become ms from the recording's start."""
    words = _speech(90, pauses={30: 2_000})
    total = words[-1].end_ms + 500
    pieces = plan_pieces(words, total)
    azure(_rest_response(["a"]), _rest_response(["b"]))
    result = pa.assess_free_speech(_silence_wav(total), words, total, "key")
    second = next(w for w in result.words if w.word == "b")
    # _rest_response puts the first word at Offset 700000 (70 ms) into its piece.
    assert second.start_ms == pieces[1].start_ms + 70
    assert second.end_ms == pieces[1].start_ms + 70 + 260
