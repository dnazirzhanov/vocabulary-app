# 0093 — The ready-made course hidden; deleting a deck from its page; «Планы» lets go of it

**Status:** Accepted (the owner, 26 November 2026: «lets hide the english course ready words … the A1-A2, B1-B2,
C1-C2 words … our planner of the app should delete those decks from the to-do list … once the user deletes certain
decks, the planner should get updated … add a delete deck button on the main page of the deck at the end … ask like
are you sure»).

## Decision
- **The course is hidden, not deleted.**
  - `COURSE_DECKS` (off by default) gates `decks.course_open`, the one check every path to course words goes
    through. With it off, the course is gone everywhere, for Russian learners too:
    - home's «Английский по уровням» and its levels;
    - the study pack a device keeps (its version changes, so a device holding the old one drops the course);
    - progress and the pace;
    - «Учёба на сегодня» in «Планы».
  - The words and everyone's progress on them stay in the database; switching it on brings the course back as it
    was. The test suites switch it on, so the course keeps being proven.
  - A course level a teacher gave a group is hidden too: it is course words.
- **«Планы» lets go of a deck that is gone.** «Учёба на сегодня» kept today's decks on the device, so a deck it no
  longer saw counted as finished. A deck that was deleted, hidden or left with its group therefore stayed, ticked.
  - Now a remembered deck is shown as done only if it is still among my decks.
  - If that can't be told (offline with no copy), nothing is dropped, as before.
- **Delete from the deck's page.** My own deck's page ends with «Удалить колоду», the same red section and the same
  question as its editor (one component, `DeleteDeck`).
  - The question names the deck and how many words and how much progress go, and the groups that lose it.
  - Cancel takes focus, so a reflexive Enter never deletes.
  - Deleted, the page goes back to where it was opened from.
  - Decks not mine (the course, a group's) have no delete.
- **Found on the way: a repeat started on the wrong day.** Tapping Wednesday then Saturday on a Thursday started
  the series next Wednesday, skipping this Saturday: each tap counted on from where the last one had moved the date.
  Now every tap counts from the date chosen (`repeatStart`).
