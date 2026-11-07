# 0056 — Each deck's spelling is its own words

**Status:** Accepted (the owner's request, 7 November 2026). Refines ADR 0026, whose sets were drawn from every word the learner had met, in any deck.

## Context
Spelling is started from a deck's page, but the server drew its words from every deck: a learner who met words in two decks today found the other deck's words in this one's spelling, and the page's counts and its unfinished spelling were the other deck's too. The owner: each deck's spelling should be the deck whose page the learner is on.

## Decision
- **A spelling session names its deck** (`deck_id`, required, a deck the learner can see). Every set (`mix`, `today`, `hard`, `random`) is drawn from that deck's words only: the words met, today's new words and the ladder are all filtered to it (`spelling_ladder.load`).
- **The deck's page and the summary after a lesson count that deck only**, and show an unfinished spelling only if it is that deck's. «Прогресс» no longer carries spelling counts; no screen showed them.
- **An unfinished spelling in another deck is set aside** when spelling starts here, as a lesson in another deck is (ADR 0035); its answers stay. The main button in its own deck still resumes it (ADR 0050).
- **The ladder stays one per word.** A word in two decks (a course word a teacher linked) is spelled from either, and climbs once.

## Consequences
- A word removed from a deck, or a deck deleted, leaves that deck's spelling, as it already leaves its flashcards. The learner's place on the ladder is kept, and comes back if the word is in another deck they study.
- A summary after a lesson whose deck was later deleted offers no spelling.
