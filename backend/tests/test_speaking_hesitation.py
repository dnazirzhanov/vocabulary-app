"""Pauses and «um»s found in real audio (tests/fixtures/speech, see make_hesitant.py).

hesitant.wav: «I think the best [900 ms] place to visit is [um] Paris. [700 ms] Because it is
very [600 ms] beautiful.» The «um» is not in the word list, as Whisper usually leaves it out.
fluent.wav: the same words with no hesitation.
"""

import json
from pathlib import Path

import pytest

from app.services.speaking.fluency import compute_fluency
from app.services.speaking.hesitation import TimedWord, analyse, fluency_score, voiced_frames
from app.services.speaking.transcription import TranscriptWord

FIXTURES = Path(__file__).parent / "fixtures" / "speech"


def _load(name: str) -> tuple[list[TimedWord], bytes]:
    words = [TimedWord(**w) for w in json.loads((FIXTURES / f"{name}.json").read_text())]
    return words, (FIXTURES / f"{name}.wav").read_bytes()


def _after(words: list[TimedWord], text: str) -> TimedWord:
    return next(w for w in words if w.text.rstrip(".").lower() == text)


def test_pauses_are_found_where_they_are_in_the_audio() -> None:
    words, wav = _load("hesitant")
    h = analyse(words, transcript_words=words, wav=wav, source="azure")
    silent = {(p.before, p.after): p for p in h.silent}
    assert set(silent) == {("best", "place"), ("paris", "because"), ("very", "beautiful")}
    # Where and how long, to within 100 ms of what was put there.
    best = _after(words, "best")
    assert abs(silent[("best", "place")].start_ms - best.end_ms) <= 100
    assert abs(silent[("best", "place")].ms - 900) <= 120


def test_a_filler_missing_from_the_transcript_is_found_in_the_audio() -> None:
    words, wav = _load("hesitant")
    h = analyse(words, transcript_words=words, wav=wav, source="azure")
    [um] = h.filled
    assert (um.before, um.after) == ("is", "paris")
    assert um.start_ms > _after(words, "is").end_ms


def test_pauses_between_sentences_are_natural_those_inside_a_phrase_are_not() -> None:
    words, wav = _load("hesitant")
    h = analyse(words, transcript_words=words, wav=wav, source="azure")
    inside = {(p.before, p.after): p.inside_phrase for p in h.silent}
    assert inside == {
        ("best", "place"): True,
        ("paris", "because"): False,
        ("very", "beautiful"): True,
    }


def test_fluent_speech_has_no_hesitations() -> None:
    words, wav = _load("fluent")
    h = analyse(words, transcript_words=words, wav=wav, source="azure")
    assert h.pauses == []


def test_hesitant_speech_scores_well_below_fluent_speech() -> None:
    hes_words, hes_wav = _load("hesitant")
    flu_words, flu_wav = _load("fluent")
    hesitant, _ = fluency_score(analyse(hes_words, transcript_words=hes_words, wav=hes_wav))
    fluent, _ = fluency_score(analyse(flu_words, transcript_words=flu_words, wav=flu_wav))
    assert fluent >= 85
    assert hesitant <= 45
    # The old formula (word gaps only, ideal wpm band, pauses only above 20 % of the time) called
    # the hesitant answer fluent, even with exact word times: the fault this replaces.
    old = compute_fluency(
        [TranscriptWord(w.text, w.start_ms, w.end_ms, 1.0) for w in hes_words],
        hes_words[-1].end_ms + 300,
    )
    assert old.score > 70


def test_whispers_own_fillers_count_where_the_audio_showed_none() -> None:
    words = [TimedWord("I", 0, 300), TimedWord("like", 350, 700), TimedWord("films", 760, 1100)]
    said = [*words[:1], TimedWord("um,", 310, 340), *words[1:]]
    h = analyse(words, transcript_words=said)  # no audio: word gaps and Whisper's tokens only
    assert [(p.kind, p.before, p.after) for p in h.pauses] == [("filled", "i", "like")]


def test_a_silent_recording_has_no_speech() -> None:
    import io
    import wave

    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(b"\x00\x00" * 16_000)
    assert not voiced_frames(out.getvalue()).any()


@pytest.mark.parametrize("azure", [None, 40.0])
def test_azure_fluency_is_averaged_in_when_present(azure: float | None) -> None:
    words, wav = _load("fluent")
    ours, evidence = fluency_score(analyse(words, transcript_words=words, wav=wav))
    with_azure, _ = fluency_score(analyse(words, transcript_words=words, wav=wav), azure)
    assert with_azure == (ours if azure is None else round((evidence["our_score"] + azure) / 2, 1))  # type: ignore[operator]
