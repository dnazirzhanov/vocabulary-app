# 0020 — Deck pages: every lesson belongs to one deck

**Status:** Accepted. Withdraws ADR 0017's "group decks first in the daily lesson"; amends ADR 0014
(home) and ADR 0019 (where decks are studied).

## Context
Home had one big button that studied "everything": due cards of every level, then words of decks
given to my groups, then the current level. A learner couldn't tell which deck they were
continuing, and group decks sat among the course's levels on home. The owner asked for study to
be tied to a deck: tap a deck, see where you are with it, study it.

## Decision
- **Home is the course's levels.** Each with today's Anki counts and its lock, and the entry to
  «Мои колоды». No «Сегодня» block and no study button: decks I wrote or my groups were given live
  only in «Мои колоды».
- **A deck's page.** Course levels and any deck from «Мои колоды» open the same page: where it
  comes from, words met out of all and remembered well (a two-tone bar, as on the progress page),
  today's new / learning / review cards, and one button that studies this deck — new words within
  the daily pace, a bonus lesson once the pace is met, reviews first while too many are due. Under
  it: today's spelling (it covers words learned today from any deck), the deck's word list with my
  status on each, «Изменить» for my own decks, the pace suggestion, the warm-up note.
- **Every lesson is one deck's.** The web always names the deck; «Дальше» on a summary keeps to it,
  and leaving a lesson returns to its page. An unfinished lesson from another deck is named and
  resumed first; an unfinished spelling session is resumed from any deck's page.
- **Group decks are studied by opening them.** Their words no longer come first in a daily lesson
  (ADR 0017): a member opens the deck in «Мои колоды». The pace, plan days and board are unchanged:
  new words from any deck count toward the day.
- A spelling session names a deck the learner can see (a course level when the word is in one),
  since a word may be linked into other people's decks.

## Consequences
- `GET /api/decks` lists course levels only; `GET /api/decks/{id}/stats` serves the page.
- The API still plans a lesson with no deck (every level's reviews, then the current level), but
  the web never asks for one.
