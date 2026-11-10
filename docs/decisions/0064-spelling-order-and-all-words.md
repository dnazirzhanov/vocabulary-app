# 0064 — Spelling: the words just learned first, and «Все слова колоды»

**Status:** Accepted (the owner's decisions, 10 November 2026). Amends ADR 0026 and 0056.

## Context
On the owner's phone test, after a lesson that introduced *passport, journey, return, tourist, guide*, the spelling asked *itinerary, luggage, delay, board*. Those were words from a lesson hours earlier, and it felt like "words I haven't seen".

Production data, read read-only with the owner's OK, showed why:
- **No unseen word had leaked in.** Every spelled word had been shown in a lesson first.
- **The main button took today's unspelled words oldest first.** It also resumed an unfinished spelling with its old words; four spellings had been left midway that day.
- **The deck page called its words «из любой колоды»,** untrue since ADR 0056.

## Decision
- **The main button (`mix`):**
  - due words first (misspelled, or climbing), as before;
  - then today's unspelled words, **newest first**, so right after a lesson it spells that lesson's words;
  - then older unspelled words, latest met first.

  It never offers a word no lesson has shown. A group's test may still put one on the ladder (ADR 0048).
- **A spelling left unfinished isn't resumed once new words were met in its deck.** The deck page stops offering «Продолжить правописание» for it, and the main button starts afresh with the new words first. What was spelled stays.
- **«Все слова колоды»** (`all`, under «Другие режимы»), for people who learn new words by spelling them (owner):
  - every word of the deck, met or not, in the deck's order;
  - words not yet spelled today first, words already «умеет писать» last;
  - 5–30 at a time.
- **A word no lesson has shown is practice when spelled.** Its try is kept and counts toward the day, but it doesn't go on the spelling ladder or introduce the word. So a miss there can never pull an unseen word into the main button. A word already on the ladder (from a group's test) moves as usual.
- **The deck page's note** says what the main button holds, without «из любой колоды».
- **Device and server keep one rule set.** `spelling_ladder.pick`/`after` and `web/src/study/spelling.ts` are held equal by the generated cases, which now include `all`, the new order and the deck's size.

## Consequences
- A long day of lessons spells the newest words first; earlier ones follow in later rounds.
- «Все слова» lets a learner meet words by spelling alone. Those words reach the main button only once a lesson shows them.
