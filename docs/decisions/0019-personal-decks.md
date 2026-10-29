# 0019 — Personal decks, «Мои колоды», and full cards from a word

**Status:** Accepted. Amends ADR 0017 (who writes decks) and builds on ADR 0018.

## Context
Decks could only be written by a group's owner, for the group. The owner wants Anki's basic
freedom too: anyone keeps their own decks and cards. Writing a card should be fast: type an
English word and the app writes the rest. Decks need a place of their own, not the course's list.

## Decision
- **Anyone writes decks.** A deck someone wrote has kind `user` (renamed from `group`): personal
  until given to a group. The assignment, not the kind, makes it a group's deck. With no group a
  deck is created by anyone (100 per person); from a group's board, only by its owner.
- **Studied by opening it.** A personal deck needs no publishing: its author studies and browses it
  in any state. Its new words come only in a session for that deck, within the daily pace; the
  «Продолжить» lesson (decks given to my groups, then the course) is unchanged. Others see it only
  through an active assignment.
- **«Мои колоды».** A screen of its own, reached from an entry under the deck list on «Сегодня»:
  «Созданные мной» (newest first; the groups each is given to) and «Из моих групп» (decks others
  gave my groups, with author and group). Each row shows what opening it would bring today; a
  row studies its deck; my decks have an edit button. An empty deck opens the editor.
- **A full card from a word.** «Быстро добавить» takes one or more words (commas, semicolons or
  lines; up to 20; the same word typed twice is asked for once) and the AI writes each card: the
  dictionary form, part of speech, its most common Russian meaning, a learner-level example and
  its translation. Cards are saved with the checks and flags of ADR 0018; unusable ones are
  reported. In the manual form, «Заполнить с ИИ» suggests the rest of a card for the typed word
  without saving it. Both count toward the 20 drafts a day.
- **Pronunciation: the device's voice for now.** Words without a recording are read by the
  browser's English voice (ADR 0013's fallback); the editor has a listen button per word. Recorded
  audio for user words needs a text-to-speech service and is a later milestone.
- **Sharing.** A personal deck can be given to a group I own, from its editor. Members giving
  words to a whole group (whose decks come first in everyone's daily lesson) needs its own rule
  and waits for a reason.
- **Removing a word.** A deck's own word nobody has met is deleted; one someone met stays, so
  they keep reviewing it (a personal deck is studied while still a draft).

## Consequences
- A group board no longer lists drafts: every deck I wrote is in «Мои колоды».
- The quality of filled cards is the model's; flags point at the obvious problems and the learner
  reviews the rest.
