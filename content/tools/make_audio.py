"""Pronunciation audio for every word, example sentence and glossary word (ADR 0013, 0070).

Spoken by Azure's neural voice en-US-AvaNeural: the same voice the server uses for words the app
has no file for (a teacher's own cards, backend/app/services/speech/tts.py), so the whole app
sounds like one voice. Files go to web/public/audio/ and are served with the app.

The voice needs the Azure Speech key, which lives only on the server, so the work is split:

    # 1. here: list what to say (needs pyyaml)
    uv run --with pyyaml python content/tools/make_audio.py --list > jobs.json
    # 2. on a machine that has AZURE_SPEECH_KEY (the Fly worker): say it, standard library only
    python make_audio.py --say jobs.json OUT_DIR
    # 3. here: copy OUT_DIR over web/public/audio and write the manifest
    uv run python content/tools/make_audio.py --manifest

Existing files in OUT_DIR are kept, so an interrupted run picks up where it stopped.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "audio"
VOICE = "en-US-AvaNeural"  # American English (the owner's choice); the server's voice too
OUTPUT = "audio-24khz-48kbitrate-mono-mp3"  # clear speech, about 10 KB a word


def slug(text: str) -> str:
    """File name for a glossary form: lowercase letters and digits ("can't" → "cant")."""
    return re.sub(r"[^a-z0-9à-ÿ]+", "", text.lower())


def jobs() -> list[tuple[str, str]]:
    """(file under web/public/audio, text) for every word, example and glossary form."""
    import yaml

    work: list[tuple[str, str]] = []
    for words_file in sorted((ROOT / "content").glob("*/words.yaml")):
        for word in yaml.safe_load(words_file.read_text(encoding="utf-8")):
            work.append((f"words/{word['id']}.mp3", word["headword"]))
            work.append((f"examples/{word['id']}.mp3", word["example"]))
    glossary = yaml.safe_load((ROOT / "content" / "glossary.yaml").read_text(encoding="utf-8"))
    for form in glossary:
        work.append((f"glossary/{slug(str(form))}.mp3", str(form)))
    return work


def say(text: str, key: str, region: str) -> bytes:
    """One call to Azure text-to-speech, waiting and retrying when it is busy (429)."""
    ssml = (
        "<speak version='1.0' xml:lang='en-US'>"
        f"<voice name='{VOICE}'>{escape(text)}</voice></speak>"
    )
    request = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode(),
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": OUTPUT,
            "User-Agent": "slovar-make-audio",
        },
        method="POST",
    )
    for attempt in range(8):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return bytes(response.read())
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503) or attempt == 7:
                raise
        time.sleep(min(60, 3 * 2**attempt))
    raise RuntimeError("unreachable")


def main(argv: list[str]) -> int:
    if argv[:1] == ["--list"]:
        json.dump(jobs(), sys.stdout, ensure_ascii=False)
        return 0
    if argv[:1] == ["--say"] and len(argv) == 3:
        work = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        out = Path(argv[2])
        key = os.environ["AZURE_SPEECH_KEY"]
        region = os.environ.get("AZURE_SPEECH_REGION", "westeurope")
        todo = [(path, text) for path, text in work if not (out / path).exists()]
        print(f"{len(todo)} of {len(work)} files to say", flush=True)
        for done, (path, text) in enumerate(todo, 1):
            target = out / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(say(text, key, region))
            if done % 50 == 0:
                print(f"  {done}/{len(todo)}", flush=True)
        print("done", flush=True)
        return 0
    if argv[:1] == ["--manifest"]:
        manifest = {
            "voice": f"Azure {VOICE}",
            "files": sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*.mp3")),
        }
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
