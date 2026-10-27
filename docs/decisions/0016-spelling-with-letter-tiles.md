# 0016 — Spelling with letter tiles, inside the daily lesson

**Status:** Accepted. Amends the plan-day rule of ADR 0015.

## Context
Flashcards teach a word's meaning but never its spelling. The owner asked for tile-based
spelling: first build the word while looking at it (guided), then build it from the Russian
meaning without seeing it (recall). Research on spelling supports a genuine hidden-answer stage
with immediate correction: in the study cited in the owner's brief
(doi:10.1080/09658211.2023.2248420), retrieval with corrective feedback gave fifth-graders better
later spelling than copying. It does not say which tile design or gap is best, so those are
product defaults.

## Decision
- **One lesson, one plan.** A study session holds the flashcards, then a «Правописание» section:
  guided practice of today's new words, then recall of the spelling reviews due, then recall of
  the new words (so each recall comes a few exercises after its guided step). Practice
  sessions have no spelling. A plan day (ADR 0015) now also needs the lesson finished, spelling
  included; mistakes never block it.
- **Letter tiles.** One tile per letter of the word (apple has two `p` tiles), letters not in the
  word up to `max(15, letters + 4)`, an alphabetical grid; if that order spells the word, a
  shuffle that does not. Generated when the lesson is planned and stored with it, so a restart
  shows the same bank. Tiles are buttons: no text field, so a phone's keyboard never opens; a
  physical keyboard can type letters into tiles.
- **Recall hides the word.** Its exercise carries the meaning, part of speech and the Russian
  example (context when a meaning has several English words), the number of letters and the tiles;
  never the headword, word id, English example or audio.
- **The server checks** a built word and discards it (ADR 0003): case and surrounding spaces are
  forgiven, misspellings never. «Показать слово» reveals it and records the hint.
- **Outcomes kept apart:** guided practice done; recall right at the first try without the hint
  (the only success); recall with help or a mistake. A miss brings guided practice at once and
  one retry later; a missed retry ends as "needs practice" — never an endless loop.
- **A schedule of its own** (`user_word_spelling`), apart from the flashcard memory: after a
  first-try recall the word returns in 1, 3, 7, 14, then 30 days; a miss starts over the next day.
  Due words come back as recall only, at most 10 per lesson. Guided never moves the schedule.
- **No credit for volume:** spelling earns no points, never a place on the board, never counts
  toward new words or the recall rate; the pace's answering speed is measured on cards only.

## Consequences
- Lessons are longer: five new words now mean five cards and ten spelling exercises.
- Days from before this rule that had their target met but no finished lesson no longer count.
- Spelling covers single plain words today (every headword is `^[a-z]+$`); spaces, hyphens and
  apostrophes as fixed separators come with content that needs them.
- A few meanings stand for more than one course word (дом: house, home); the Russian example is
  shown for context, and after a miss the intended word is shown.
