"""Pronunciation audio for every word, example sentence and glossary word (ADR 0013).

Generated once with Kokoro, an open-weight neural text-to-speech model (Apache-2.0), so every
learner hears the same natural voice instead of whatever their device's speech engine offers.
Files go to web/public/audio/ and are served with the app; existing files are kept, so only new
content is generated. Run from the repository root:

    uv run --python 3.12 --with "kokoro>=0.9" --with soundfile --with pyyaml \\
        python content/tools/make_audio.py

Needs ffmpeg (MP3 encoding). The model (~330 MB) is downloaded on first use.
"""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import soundfile
import yaml
from kokoro import KPipeline

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "audio"
VOICE = "af_heart"  # American English, the model's clearest voice
SAMPLE_RATE = 24_000


# Exact pronunciations where the model's own reading was misheard in the Whisper check
# (content/tools/check_audio.py): Kokoro accepts inline phonemes as [word](/phonemes/).
PRONUNCIATIONS = {
    "have": "[Have](/hæv/).",
    "she": "[She](/ʃˈi/).",
    "our": "[Our](/ˈaʊɚ/).",
    "tea": "[Tea](/tˈiː/).",
    "bank": "Bank!",
    "street": "Street!",
}


def spoken(text: str) -> str:
    """What the model reads. A lone word gets a capital and a full stop, so it is said with a
    natural falling tone and a clean ending (bare words sometimes trailed into another sound)."""
    if " " in text:
        return text
    return PRONUNCIATIONS.get(text.lower(), f"{text[:1].upper()}{text[1:]}.")


def slug(text: str) -> str:
    """File name for a glossary form: lowercase letters and digits ("can't" → "cant")."""
    return re.sub(r"[^a-z0-9à-ÿ]+", "", text.lower())


def jobs() -> list[tuple[Path, str]]:
    work: list[tuple[Path, str]] = []
    for words_file in sorted((ROOT / "content").glob("*/words.yaml")):
        for word in yaml.safe_load(words_file.read_text(encoding="utf-8")):
            work.append((OUT / "words" / f"{word['id']}.mp3", word["headword"]))
            work.append((OUT / "examples" / f"{word['id']}.mp3", word["example"]))
    glossary = yaml.safe_load((ROOT / "content" / "glossary.yaml").read_text(encoding="utf-8"))
    for form in glossary:
        work.append((OUT / "glossary" / f"{slug(str(form))}.mp3", str(form)))
    return work


def main() -> int:
    todo = [(path, text) for path, text in jobs() if not path.exists()]
    print(f"{len(todo)} audio files to generate")
    if not todo:
        return 0
    pipeline = KPipeline(lang_code="a")
    for path, text in todo:
        path.parent.mkdir(parents=True, exist_ok=True)
        chunks = [audio for _, _, audio in pipeline(spoken(text), voice=VOICE, speed=1.0)]
        with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
            soundfile.write(wav.name, [s for chunk in chunks for s in chunk], SAMPLE_RATE)
            # Mono MP3 at 48 kbit/s: clear speech, about 10 KB for a word.
            subprocess.run(
                ["ffmpeg", "-loglevel", "error", "-y", "-i", wav.name, "-ac", "1", "-b:a", "48k",
                 str(path)],
                check=True,
            )
        print(f"  {path.relative_to(OUT)}  ←  {text}")
    manifest = {"voice": f"Kokoro {VOICE}", "files": sorted(
        str(p.relative_to(OUT)) for p in OUT.rglob("*.mp3"))}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
