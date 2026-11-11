# Reading Mode: hypothesis

## We believe that
Learners who can read interesting, level-appropriate English, tap any word for its meaning, and
keep the words they choose as flashcards will:
- **learn more words they care about**: words met in a story they chose, in a real sentence;
- **come back more often**: reading is something to look forward to, not only a duty.

## We'll know it's true if (testers, first 2–3 weeks)
| Signal | Target | How we read it |
|---|---|---|
| Testers who open at least one article | ≥ 70% | the server logs `/reading/*.json` requests per account |
| Articles finished per active tester per week | ≥ 2 | «Готово» on the device (asked in the check-in; progress isn't synced) |
| Words saved per finished article | 3–15 | the cards in reading decks (database, read-only) |
| Saved words then studied in a lesson | ≥ 50% | reviews of cards in reading decks |
| Testers who say reading is their favourite part | ≥ half | a short check-in conversation |

## We'll know it's false or needs rework if
- testers open the library but rarely finish an article (the text is too hard, too long or dull);
- words are saved but never studied (saving is a habit, but the flashcards don't follow);
- testers find tapping fiddly (missed taps, accidental sheets) or the reader slow.

## What we are not testing yet
- Whether reading **replaces** the course: both stay.
- *Think* and *Express* (writing or speaking about what was read).
- Content in languages other than Russian.
- Growth or retention effects at scale: there are 5–10 testers, so the evidence is qualitative.
