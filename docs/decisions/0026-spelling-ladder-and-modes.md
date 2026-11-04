# 0026 — Spelling: a ladder per word, ten words at a time, and modes

**Status:** Accepted. Refines 0016 (which words a spelling session takes).

## Context
A spelling session held a card for every word learned that day. A learner who took many bonus
lessons faced hundreds of words in one sitting. Nothing remembered which words a learner spells
easily and which not, so the hard ones were never practised more than the rest.

## Decision
- **A ladder per word** (`spelling_progress`, `services/spelling_ladder.py`), apart from FSRS's
  memory of the meaning:
  - A miss, or a hinted answer, puts the word on the bottom rung, «трудное», due the next day.
  - Right on the first try when the word is due (or never spelled), it climbs: due again in 3
    days, then in 7, and on the third rung it is «умеет писать» and leaves the rotation.
  - Right before it is due changes nothing, so climbing always takes separate days.
  - Only first tries count; days start at 4 AM, as for reviews (ADR 0025).
- **One main button, ten words**: hard and climbing words that are due (hardest first), then
  today's new words never spelled, then older words never spelled. 5, 10, 20 or 30 can be asked
  for; the buttons offer 10.
- **Other modes, one tap below** («Правописание: другие режимы»): «Сегодняшние» (today's words,
  those not spelled yet today first), «Трудные» (the bottom rung) and «Вразброс» (a draw from every
  word met, never-spelled words three times as likely, known ones rarely).
- **After a lesson** the summary offers spelling while today's words are not yet spelled; after
  spelling it offers the next ten while the main set holds any, and says that misspelled words
  come back tomorrow. «Прогресс» shows how many words are «умеете писать» and how many are hard.
- **Spelling left midway is kept, not hidden.** One unfinished spelling session may stay open
  beside an unfinished lesson, so it never blocks a lesson. Every deck's page (not home) shows it
  as «Правописание не закончено» with how many words were spelled (right, with a mistake) and
  how many are left; «Продолжить» resumes at the next word. Starting spelling again resumes it,
  whichever set is chosen.
- Existing spelling answers were replayed into the ladder by the migration (hinted ones as misses).

## Consequences
- A big day is spelled in tens, and spelling time goes to the words that need it.
- Spelling still never keeps a day or earns a place on the board (ADR 0022); the day's plan no
  longer counts spelled words at all.
