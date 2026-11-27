# 0100 — The server fetches a YouTube video's captions

**Status:** Accepted (the owner, 27 November 2026: «why don't we run this script every time a user pastes a
link? … we use the yt-dlp commands»; asked about YouTube's terms: «yes, accept the risk, test it on fly»).
Changes ADR 0097, where the learner always pasted the text.

## Context
- **The hard step:** pasting the video's text with its times from YouTube's «Show transcript» was the one hard
  step of making an exercise (ADR 0097), and too hard for children.
- **Tested on 27 November:**
  - yt-dlp fetched a video's English captions from this Mac, and three times out of three from the production
    Fly machine (Stockholm), in about 3–5 s.
  - A plain request for the caption file got an empty answer; yt-dlp knows how to ask.
- **The owner accepts the risk:** this goes beyond YouTube's terms, which allow automated access only to search
  engines or with YouTube's written permission.

## Decision
- **Fetched on check:** when a link is checked, the app asks the server for the video's text
  (`POST /shadowing/youtube/transcript`).
  - The server runs yt-dlp as a library and fetches only the captions (json3), never video or audio.
  - Only the text and times are kept.
- **Which captions:**
  - the channel's own English subtitles first;
  - then YouTube's English speech recognition (`en-orig`, or `en` on an English video);
  - never a machine translation into English, since its words are not what is said.
  - The screen says which it is: automatic captions «проверьте, нет ли ошибок».
- **Once per video:**
  - The result is kept in `youtube_transcripts` for everyone, so a class sharing one video asks YouTube once.
  - No captions, or a failed fetch, is kept as `none` and retried only after an hour.
- **Bounded:**
  - at most 3 fetches at once, a 25 s limit;
  - 30 asks a learner an hour (`youtube_captions_per_hour`);
  - a switch, `YOUTUBE_CAPTIONS=false`, keeps only what was already fetched.
- **Pasting stays:**
  - when nothing is found, the paste box appears as before;
  - «Вставить свой текст» replaces found text.
- **Choosing the part:** «Начать с» (each minute of the video) and «Сколько учить» (1, 2, 3, 5 or 10 minutes)
  pick the part; the sentence lists fine-tune it. Ten minutes stays the most (ADR 0097).
- **No ways round YouTube's blocks:** no signed-in cookies, no proxies. If YouTube starts refusing the server,
  learners paste again.

## Consequences
- **yt-dlp must be kept current:** it is updated often to keep up with YouTube, so an old version may stop
  finding captions. Then the paste box appears, and updating the dependency fixes it.
- **Without a JavaScript runtime:** yt-dlp warns that it has none (it prefers deno), and fetching works without
  one today. If YouTube comes to require one, adding deno to the image is the fix.
- **YouTube may block the server's address at any time;** the fallback is pasting.
