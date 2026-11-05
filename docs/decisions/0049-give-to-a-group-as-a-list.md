# 0049 — Giving a deck to a group: one list of my groups

**Status:** Accepted (the owner's request, 5 November 2026). Replaces the contents of ADR 0036's window; the window and its button stay.

## Context
The window held a paragraph of explanation, one block for each group that had the deck, each with its own date field and links, then a form for one more group with a dropdown, another date
field and a button, and a sentence once no group was left. The owner found it ugly and noisy.

## Decision
**The window is one list of my groups,** in the order they always have, so rows don't jump. Each row says whether the group has the deck, with one thing to do beside it:

| The group | The row | Beside it |
|---|---|---|
| Hasn't got it | Its name | «Дать», one tap with nothing to fill in |
| Has it | ✓ and its name, then «Указать срок» or «К 13 ноября ×» | «Забрать», quiet |

- **The deadline reads as text and opens the date picker,** rather than being a form field that is mostly only read. A real date input lies invisibly over the words, so the phone's own picker opens.
- **No explanation.** Someone with no group gets one line saying to create one. What a deadline does to the words is said where it matters, on the deck's page for those studying it.

## Consequences
- Giving with a deadline takes two steps rather than one form. Most decks have none, and it is one more tap for those that do.
- The owner no longer reads, in this window, that a deadline spreads the words over the days. If that turns out to surprise people, it fits as a small note once a date is set.
