# 0017 — Teachers' decks, given to a group, met first within the learner's own pace

**Status:** Accepted. Amends ADR 0014 (which decks a learner sees) and ADR 0016 (phrases).
Amended by ADR 0019: anyone writes decks (kind `group` renamed `user`); drafts live in «Мои колоды».

## Context
A teacher told us how he prepares vocabulary homework today: he asks ChatGPT for the words in
his lesson material, then builds cards by hand (meaning, example, pronunciation) and sends them
to his students one by one. The product promise we want to test is "turn any English lesson into
ready-to-assign vocabulary practice". This record covers the part without AI: a deck a teacher
writes and gives to a group. Generating the deck from the teacher's text comes next and fills
the same deck.

## Decision
- **A group deck.** `decks.kind` is `course` (the levels, from `content/`) or `group` (a teacher's
  deck, written in the app). A group deck has an author (`owner_id`), starts as a draft and is
  published when it is first given to a group. Only its author sees or edits it; anyone else gets
  404, like any missing deck.
- **Only a group's owner gives words.** In this version the creators are teachers: making a deck
  needs a group one owns, and only the owner gives a deck to the group or takes it back. A member
  who tries gets 403, since they can see the group. Students' own decks will reuse the same deck
  and the same screens later.
- **Course words are linked, not copied.** A word with the same spelling and part of speech as a
  course word is that course word, with the course's content, so nobody learns it twice and its
  schedule is shared. A teacher's own words get ids `t-…` and belong to their deck
  (`words.owner_deck_id`).
- **Corrections, not versions.** A published deck can be corrected and added to; learners see a
  corrected word at its next showing, with their schedule untouched. A word taken out of a
  published deck is no longer introduced, but stays, so whoever met it keeps reviewing it. A deck
  taken back from a group (`deck_assignments.removed_at`) works the same way. Immutable published
  versions were considered and left for when a deck is shared beyond one teacher's groups.
- **First within the learner's own pace.** A member's daily lesson takes its new words from the
  decks given to their groups first (oldest first, in deck order), then from the current course
  level, all within the daily pace they chose (ADR 0010). The day's plan, plan days (ADR 0015) and
  the board's ranking are unchanged: a teacher's words are just the day's new words. Whoever gave
  a deck is a member too and learns it the same way, at their own pace (changed on Oct 29 2026 at
  the owner's request: first the giver was left out).
- **Not the course.** A teacher's own words never count toward the course's sourced goal (about
  1,300 words, ADR 0010) or the progress figure measured against it. Home lists given decks first,
  saying where each comes from («ваш набор · 7Б», «от Ольга · 7Б», or «группа 7Б» once the
  author has left), and their Anki-style counts include today's new words from them.
- **On the board.** Each given deck is listed with its word count. Every member, the giver too, sees
  how many of its words they have met; the owner sees everyone's count, listed by name, not by number, since
  the board rewards promises kept, never volume.
- **Phrases.** A headword may be a phrase: lowercase letters, words joined by one space, hyphen or
  apostrophe (`carry out`, `well-known`). Spelling shows the separators as fixed gaps, never tiles;
  a hint names a slot among the letters only; a phrase wraps between its words, never inside one.
- **Limits.** At most 50 words in a deck and 100 decks per author.

## Consequences
- The card highlights the target word in its example only when the example uses the headword
  itself; a phrase or an inflected form ("carried out") is not highlighted.
- Teachers' words have no recorded audio yet: the browser's own English voice reads them (the
  fallback from ADR 0013) until pronunciation is generated for them.
- Tap-a-word explains a teacher's example only through the course glossary; forms it lacks show
  no meaning yet.
