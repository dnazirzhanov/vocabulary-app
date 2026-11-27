# 0097 — Shadowing from a YouTube video: a link and its pasted text make an exercise

**Status:** Accepted (the owner, 26 November 2026: «we kinda have to automate the shadowing part … paste a
youtube link and then create a shadowing exercise out of that youtube video … it only would cost just pasting a
link»). Of ten ways considered, the owner chose:
- **The source:** a YouTube link plus the text pasted from YouTube's «Show transcript».
- **Who makes them:** everyone, for themselves; teachers give them to groups as a task's material (ADR 0096).

## Context
Shadowing had one hand-made exercise:
- an audio file stored by us;
- sentences and times typed into `content/shadowing/exercises.yaml`;
- loaded by `load-shadowing`.

Each new exercise took an engineer.

YouTube's terms decide the shape:
- Only YouTube's own player, visible (at least 200×200), may play a video. There is no downloading and no audio
  apart from the video, so `yt-dlp` and Whisper on the sound are out.
- The video's subtitles can't be fetched from our server either. The official captions API wants the video
  owner's sign-in, and the unofficial endpoints refuse cloud hosts such as Fly and keep changing.

## Decision
- **An exercise keeps only:**
  - the video's id (`source = 'youtube'`, `youtube_id`);
  - the chosen part (`clip_start_ms`, `clip_end_ms`);
  - the sentences with their times in the video;
  - its owner (`created_by`).

  No sound or picture of the video is stored. The thumbnail is YouTube's own address. The columns are nullable
  or defaulted, so the change is backward-compatible.
- **The video plays in YouTube's IFrame player**, through `www.youtube-nocookie.com` with `playsinline`, `rel=0`,
  `origin` and `widget_referrer`, shown on the screen. Our buttons seek, play and pause it.
- **Making one, on one screen:**
  1. **The link.** The server asks YouTube's oEmbed whether it may show the video here and for its title, with a
     5 s limit. The request carries only the public video's address. A private or removed video, or one that
     refuses embedding, is said plainly.
  2. **The text.** The learner pastes the transcript, or picks an `.srt`/`.vtt` file. The device parses it
     (`shadowing/youtube/transcript.ts`):
     - it reads the times;
     - it leaves out the title, chapter names and `[Music]`;
     - it builds sentences at `.?!`. Automatic captions have no punctuation, so it splits them at pauses, never
       longer than ~10 s or 18 words;
     - each sentence ends where the next begins.

     Text without times is refused with how to copy it.
  3. **The part.** First and last sentence, with the first minute suggested. Each sentence can be heard (▶),
     corrected, joined with the next or removed. Then a name and a level, and «Сохранить».
- **The server checks it again:**
  - 1–200 sentences, in order and inside the part;
  - a part of up to 10 minutes;
  - up to 300 characters a sentence;
  - at most 50 exercises of one's own (`too_many_exercises`).
- **Who sees it:**
  - curated ones (no owner) are seen by everyone;
  - one's own are seen by their owner;
  - those a group's task links are seen by its members.

  Nobody else may open or start one. Only its owner changes or removes it. Removing puts it away
  (`is_active = false`), so a task linking it still names it.
- **Shadowing is everyone's:** the Speaking tab shows for all. Someone who isn't a Speaking tester goes straight
  to shadowing, and free speaking stays for testers.
- **`load-shadowing` runs on every deployment** and now switches off only curated exercises that left the YAML,
  never learners' own.

## Consequences
- Making an exercise costs a paste of a link and a paste of text, with nothing to store or pay for.
- Copying the transcript is easiest on a computer: YouTube's phone app doesn't let one copy it. The screen's
  hint says to use a computer, or a subtitle file.
- An exercise depends on the video staying up and embeddable. If it goes, the exercise says so, and its owner
  can remove it.
- Android: YouTube's player in a WebView without a referrer can fail with error 153. The player passes `origin`
  and `widget_referrer`, but it is still unproven on a device.
- Options kept for later, which can use the same player:
  - an uploaded file of one's own, timed by Whisper;
  - a teacher recording themselves;
  - openly licensed libraries.
