# 0013 — Recorded neural-voice audio, and every example word tappable

**Status:** Accepted

## Context
The owner found the pronunciation "very bad" and slow. It came from the browser's built-in speech
engine (`speechSynthesis`), whose voices differ by device and are often poor; we also slowed it to
0.9×. They also asked for every word of the example sentence to open a small card with its Russian
meaning and audio, and for each new card to say its word automatically.

## Decision
- **Audio is generated ahead of time** with Kokoro (open weights, Apache-2.0), voice `af_heart`,
  at normal speed, one MP3 per headword, example sentence and glossary word
  (`content/tools/make_audio.py` → `web/public/audio/`, about 12 KB per word). Every learner hears
  the same natural voice; files are served with the app and cached by the browser.
  - A lone word is read with a capital and a full stop ("Book."), which removed trailing sounds the
    model added to bare words; exact phonemes can be given per word (`have` → /hæv/).
  - **Checked by machine:** `content/tools/check_audio.py` transcribes every file with Whisper and
    reports mismatches. Lone function words and homophones (the, a, I; buy/bye) cannot be judged
    without context and are checked by ear.
  - Comparing six Kokoro voices on the starter words, `af_heart` was recognised best.
  - If a file is missing, the browser voice is used as a fallback (best English voice available).
- **Auto-play:** each new card plays its word when it appears; the next card's file is preloaded.
  A speaker toggle in the lesson's top bar turns this off (remembered on the device).
- **Tap-a-word:** `content/glossary.yaml` gives every word form used in an example its Russian
  meaning, dictionary form and an optional note (*lives → live*, *don't = do not*). The validator
  fails if any example word is missing, so new content cannot ship with untappable words. The
  glossary is imported with the content and served by `GET /api/glossary`. Each example word is a
  button; its popover shows the word, the meaning, the dictionary form and an audio button, and
  closes on a tap elsewhere, Escape or scrolling.
- The card no longer shows "Новое слово" or the part of speech (owner request).

## Consequences
- Content changes need `make_audio.py` (and ideally `check_audio.py`) before release; existing
  files are kept, so only new words are generated. The model (~330 MB) is a developer download,
  not part of the app.
- The glossary is a third piece of content to review for Russian quality.
