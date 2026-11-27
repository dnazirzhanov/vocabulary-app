# 0098 — Shadowing sentence by sentence, made for children

**Status:** Accepted (the owner, 26 November 2026: «make it easy to pause, continue, move, and then record our
responses … really convenient and intuitive so that it is easy even for kids»). The owner chose sentence by
sentence as the default, with speaking along with the whole part kept as a second mode.

## Decision
- **One sentence at a time** (`shadowing/SentencePractice.tsx`). The video (or our audio) is on top, then one
  big sentence with the next one faded under it, then one big button that is always the next step:
  1. **«Слушай»** plays exactly this sentence (`playSegment`) and stops by itself. The words light up as they
     are said, estimated from the sentence's time.
  2. **«Твоя очередь»** records. It stops by itself after the sentence's length × 1.6 + 1.5 s, or with «Стоп».
     The video is paused meanwhile, so its sound isn't recorded over the voice, and no headphones are needed.
  3. **«Сравни»:** «Оригинал» (the sentence again), «Я» (the recording) and «Ещё раз», then «Дальше».
- **Around it:**
  - dots for the sentences, each a way to it;
  - ‹ › to move;
  - «Медленнее» (0.75×);
  - Space and ← → on a keyboard;
  - a numbered strip «1 · Слушай — 2 · Твоя очередь — 3 · Сравни» showing where one is.
- **Layout:** on a wide screen the video and sentence sit on the left and the steps and buttons on the right, all
  in view. On a short phone, the faded next sentence and the strip give way so the big button stays in view.
- **«Говорить вместе»:**
  - **For a YouTube exercise:** the whole part plays while the learner speaks along, with headphones, then
    both can be heard.
  - **For a curated exercise:** it opens the existing speak-along screen with its saved recordings.
- **Recordings stay on the device.** Nothing of a child's voice is sent to us. Finishing, with at least one
  sentence said, records a completed attempt without audio, which ticks a group task linking the exercise
  (ADR 0096).
- **YouTube's player is driven through `shadowing/youtube/player.ts`:**
  - It waits for real playback before counting time, so an ad or buffering doesn't cut a sentence short.
  - It pauses at the sentence's end, checking every 50 ms.
  - Our own audio has the same controls (`audioPlayer.ts`), so curated exercises get this mode too.

## Consequences
- Children get one button and one sentence at a time, with no headphones needed. Speaking along stays for
  those who want it.
- The pause lands within about 50 ms of the sentence's end, plus YouTube's own reporting delay.
- iOS may lower the video's sound while the microphone is open, or want a first tap on the video itself before
  our buttons can play it. Both need checking on a phone.
