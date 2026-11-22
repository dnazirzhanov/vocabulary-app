"""Builds hesitant.wav / fluent.wav and their word timings (run on macOS: uses `say` and ffmpeg).

Each word is synthesised on its own and joined with known silences, so every word's time is exact.
The «um» in hesitant.wav is NOT in the word list: like Whisper, the "transcript" leaves it out, and
the detector must find it in the audio.

    cd backend && python tests/fixtures/speech/make_hesitant.py
"""

import json
import subprocess
import tempfile
import wave
from pathlib import Path

HERE = Path(__file__).parent
RATE = 16_000

# (text, silence after it in ms, in the transcript?)
HESITANT = [
    # A long pause inside a phrase.
    ("I", 60, True), ("think", 60, True), ("the", 60, True), ("best", 900, True),
    ("place", 60, True), ("to", 60, True), ("visit", 60, True), ("is", 250, True),
    ("um", 300, False),  # a filler the transcript lacks
    ("Paris.", 700, True),  # a pause after a sentence: natural
    ("Because", 60, True), ("it", 60, True), ("is", 60, True), ("very", 600, True),  # mid-phrase
    ("beautiful.", 0, True),
]  # fmt: skip
SENTENCE = "I think the best place to visit is Paris because it is very beautiful."
FLUENT = [(w, 60, True) for w in SENTENCE.split(" ")]
# Cut the silence `say` leaves around each word, so the joins are the only gaps.
TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:stop_periods=-1:stop_threshold=-50dB"


def synth(text: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        aiff, wav = Path(tmp) / "w.aiff", Path(tmp) / "w.wav"
        say = ["say", "-v", "Samantha", "-o", str(aiff), text]
        subprocess.run(say, check=True)  # noqa: S603
        convert = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(aiff), "-ac", "1"]
        convert += ["-ar", str(RATE), "-af", TRIM, "-sample_fmt", "s16", str(wav)]
        subprocess.run(convert, check=True)  # noqa: S603
        with wave.open(str(wav), "rb") as w:
            return w.readframes(w.getnframes())


def build(name: str, parts: list[tuple[str, int, bool]]) -> None:
    pcm, words, t = b"", [], 300
    pcm += b"\x00\x00" * (RATE * 300 // 1000)  # lead-in silence
    for text, gap, listed in parts:
        audio = synth(text)
        ms = len(audio) * 1000 // (2 * RATE)
        if listed:
            words.append({"text": text, "start_ms": t, "end_ms": t + ms})
        pcm += audio + b"\x00\x00" * (RATE * gap // 1000)
        t += ms + gap
    with wave.open(str(HERE / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    (HERE / f"{name}.json").write_text(json.dumps(words, indent=1) + "\n")


if __name__ == "__main__":
    build("hesitant", HESITANT)
    build("fluent", FLUENT)
