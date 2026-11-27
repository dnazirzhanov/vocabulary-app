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

## Amendment (27 November 2026): how the sentences are made
The owner, on a real podcast's automatic captions: «sometimes the sentences are too short and not worth for the try.
and sometimes, they are too long. and there is clearly misalignment with the audio and the text».

What went wrong:
- **Repeated text:** YouTube's automatic `.vtt` repeats each line above the new one (a rolling window), and the
  parser kept both. So each sentence carried the words of the line before it, and its text no longer matched its
  time in the video.
- **Speaker marks:** «>>» (another speaker) was shown as «&gt;&gt;».
- **Bad lengths:** every «Yes.» or «Hm.» became a sentence of its own.

Now:
- **Each word said once, at its own time:**
  - only the new words of a rolling cue are kept, and its 10 ms scrolling cues are dropped;
  - each word takes its own time when the captions give one: the inline `<00:00:09.120>` of a `.vtt`, or the
    `tOffsetMs` of the server's json3 (ADR 0100). So a sentence starts and stops with its words, not with a
    caption line.
- **Where sentences end:** at `.?!` but not after «Mr.», «a.m.» and other abbreviations, and where another
  speaker starts («>>», which is never shown).
- **Lengths:**
  - at most 15 words and 8 s, so a longer one is cut at a comma or a pause near its middle;
  - at least 3 words and 1.2 s, so a shorter one joins a neighbour, the same speaker's first.
- **On a real 14-minute podcast:** 238 sentences of 3–15 words, none over 7.6 s.

Exercises saved before this keep their sentences; making one again from the same video gives the new ones.

## Second amendment (27 November 2026): sentences people can say, text in step with the sound
The owner, on learners' feedback: sentences were «cut mid sentence», some too long and some too short, and «the
mismatch between [the audio and the text] also makes users very disappointed».

**Found in production:** every exercise still had sentences from the code of two releases before. A tab left
open runs the code it opened with, so open tabs now load a new release at the next tab change (the plan's PR A).

**Ten ways were weighed for each problem.**

**Sentences, what was chosen:**
- **Whole sentences** up to 20 words / 10 s (was 15 / 8 s, which cut whole sentences at a comma).
- **Cutting a longer one:** it is cut where a speaker breathes. That means after a comma, at a real pause in the
  speech, or before «and / because / which…»; never after «the / to / my…» or inside «Mr. Smith».
- **Joining a short one:** a short sentence joins its own speaker. It crosses to the other speaker only when it is
  a lone word («Yes.», «Hm.»).
- **Splitting by hand:** the creator can split a sentence at a tapped word («Разделить»).

**Sentences, set aside:**
- an AI model choosing the breaks: it costs money, adds delay and an outside dependency;
- a browser sentence splitter: it adds little;
- lengths per level: later.

**Timing, what was chosen:**
- **The channel's own subtitles come one line at a time.** The server now also fetches YouTube's speech
  recognition for the video, word by word (`words`, kept with the captions).
  - The device matches the subtitles' words to the recognised ones, in order and within each line's time, so
    each word takes the time it is said. A word left unmatched is placed between its neighbours.
  - On a real video: a sentence's start against its first word heard was 494 ms off typically and 1.3 s in one
    sentence of ten; now it is 0 ms and within 0.15 s.
- **Margins:** a sentence starts 0.15 s before its first word and ends 0.3 s after its last, never into the
  next.
- **Stopping on time, measured on real YouTube** (desktop Chromium, six sentences of the podcast): the old
  rule paused 15–50 ms after a sentence's end; the new one pauses 36–55 ms before it. Playing an earlier sentence
  again after a later one played it whole with both rules.
  - So on desktop the player was not the cause of the mismatch; the old code in open tabs and the line-level
    times were.
  - The new clock is kept as a safeguard for slower devices, which may report the time less often or late
    after a seek; it is not measured on phones. It believes a time only once one near the start has come,
    runs on by the clock between reports, and pauses 60 ms early.
- **One «Текст и звук» shift** on the create screen (±0.1 s steps, up to ±2 s), for subtitles a little off.

**Timing, set aside:**
- aligning on the downloaded audio, or Whisper on it: YouTube's terms, blocks and cost;
- analysing the sound in the browser: impossible, since the player's sound can't be read.

**Speed:** «Медленнее» became − 1× + (0.5–1.5×, as YouTube offers). The card shows only the sentence being said.
