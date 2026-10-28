# 0016 — Spelling with letter tiles: one card per new word, part of the day's plan

**Status:** Accepted. Amends the plan-day rule of ADR 0015.

## Context
Flashcards teach a word's meaning but never its spelling. The owner asked for spelling with
letter tiles. A first version (guided building with the word visible, recall later in the same
lesson, retries, hints and a review schedule) was judged too complicated and replaced by this one.
Research on spelling supports building the word from memory with immediate correction: in the
study cited in the owner's brief (doi:10.1080/09658211.2023.2248420), retrieval with corrective
feedback gave fifth-graders better later spelling than copying. It does not say which tile design
is best, so those choices are product defaults.

## Decision
- **One exercise, one card per word.** A spelling card shows a word's Russian meaning (and its
  Russian example, for context when a meaning has several English words), empty slots and letter
  tiles; the learner builds the English word. Nothing else: no guided step, no reviews.
- **Its own session and button.** The lesson stays flashcards only. «Правописание» starts a
  spelling session with a card for every word learned today, in the order learned. Once the cards
  are done it is home's main button and the next step on the lesson's summary; afterwards
  «Правописание · ещё раз» repeats it as often as wanted.
- **Part of the plan.** A plan day (ADR 0015) needs the day's planned new words spelled once in a
  finished spelling session. Mistakes never block it; extra spelling never adds to it, never earns
  points and never raises a place on the board.
- **Letter tiles.** One tile per letter of the word (apple has two `p` tiles), letters not in the
  word up to `max(15, letters + 4)`, an alphabetical grid; if that order spells the word, a
  shuffle that does not. Generated when the session is planned and stored with it, so a restart
  shows the same bank. Tiles are buttons: no text field, so a phone's keyboard never opens; a
  physical keyboard can type letters into tiles. A half-built word survives a reload.
- **One hint per card.** «Подсказка» asks the server for the letter of the next empty slot and
  places that tile there (marked as a hint). One per card: asking again for the same slot returns
  the same letter, any other slot is refused, so the word can never be drawn out letter by letter;
  the hint is kept with the session, so a reload does not give a second one. A hinted answer is
  still checked like any other.
- **The word is never sent before it is answered.** The server checks the first try and discards
  the built word (ADR 0003): case and surrounding spaces are forgiven, misspellings never. Only
  the first try is stored. After a mistake the word is shown, with the differing letters marked
  (underlined, not colour alone), and the card may be built again until it is right — checked on
  the device, since the word is then visible — or left with «Дальше».

## Consequences
- Days from before this rule whose words were never spelled no longer count toward the plan.
- Spelling covers single plain words today (every headword is `^[a-z]+$`); spaces, hyphens and
  apostrophes as fixed separators come with content that needs them.
- A few meanings stand for more than one course word (дом: house, home); the Russian example is
  shown for context, and a mistake shows the intended word.
