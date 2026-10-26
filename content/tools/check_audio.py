"""Listens to every generated audio file with Whisper (speech recognition) and reports files whose
transcription differs from the text, so mispronunciations are caught without a human listening.

    uv run --python 3.12 --with faster-whisper --with numpy --with pyyaml \\
        python content/tools/check_audio.py

Lone function words (the, a, I) and homophones (buy/bye) are hard to recognise without context;
judge those by ear.
"""

import re
import subprocess

import numpy as np
import yaml
from pathlib import Path

from faster_whisper import WhisperModel

root = Path(__file__).resolve().parents[2]
out = root / 'web/public/audio'
def slug(t): return re.sub(r"[^a-z0-9à-ÿ]+", "", t.lower())
expect = {}
for words_file in sorted((root / 'content').glob('*/words.yaml')):
  for w in yaml.safe_load(words_file.read_text()):
    expect[out/'words'/f"{w['id']}.mp3"] = w['headword']
    expect[out/'examples'/f"{w['id']}.mp3"] = w['example']
for f in yaml.safe_load((root/'content/glossary.yaml').read_text()):
    expect[out/'glossary'/f"{slug(str(f))}.mp3"] = str(f)
model = WhisperModel('medium.en', compute_type='int8')
norm = lambda s: re.sub(r"[^a-z]", "", s.lower().replace('café', 'cafe'))
bad = 0
for path, text in expect.items():
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], capture_output=True, check=True).stdout
    segments, _ = model.transcribe(np.frombuffer(raw, np.float32), language='en', beam_size=5)
    heard = ' '.join(s.text for s in segments).strip()
    ok = norm(heard) == norm(text)
    if not ok:
        bad += 1
        print(f"MISMATCH {path.relative_to(out)}: expected {text!r}, heard {heard!r}")
print(f"{len(expect) - bad}/{len(expect)} heard exactly as written")
