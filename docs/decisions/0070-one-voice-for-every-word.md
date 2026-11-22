# 0070 — One voice for every word

**Status:** Accepted (the owner's decisions, 19 November 2026). Amends ADR 0013.

## Context
A group's teacher reported that word pronunciation was "terrible, and each member of the group got different
pronunciations". The cause: the app had recordings (Kokoro `af_heart`, ADR 0013) for its 300 starter words only. A
teacher's own words, which every group test deck is made of, had no file, so each browser or phone spoke them in its
own built-in voice. The owner asked for Cambridge's or Oxford's pronunciations; those recordings are copyrighted and
their terms forbid copying them, and Oxford's licensed audio is a paid contract.

## Decision
**One neural voice for everything: Azure `en-US-AvaNeural`, American** (the owner's choice of source and accent).
- The starter words, examples and glossary forms (1,385 files) are regenerated in that voice
  (`content/tools/make_audio.py`, run on the server, where the Azure key lives).
- A word or example with no file is spoken by the same voice on the server (`GET /api/pronunciation?kind=&text=`),
  once: the MP3 is kept in storage and the `pronunciation_audio` table (row-level security on) and served to everyone
  after that, so a whole class hears the same file.
- Only a card's English is spoken (length and character checks). A learner may have 500 new texts spoken a day;
  texts already made are free.
- Offline, or if the voice fails, the device's own voice speaks, as before.

## Consequences
- The same Azure Speech resource as Speaking. A new word costs a fraction of a cent; a known one costs nothing.
- If the Azure resource is on the free tier, its rate limit (about 20 requests a minute) can make a class's first
  plays of brand-new words fall back to device voices for a moment; later plays use the kept file.
- An installed app that hasn't refreshed keeps the device voices until it updates.
