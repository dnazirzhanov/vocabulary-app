# 0036 — Giving a deck to a group, in a window

**Status:** Accepted. Refines ADR 0017 and 0028 (where a deck is given, and its «Выучить к»).

## Context
The deck editor ended with a «Группы» section: a paragraph, the groups the deck was given to, and a
form to give it to another. It sat below the whole list of cards, far from where the teacher works,
and nothing on a deck's own page led to it.

## Decision
- **One window, «Дать группе»,** holds it all:
  - the groups that have the deck, each with its «Срок» (change it, or «Без срока») and «Забрать»;
  - a form for one more group: the group, an optional «Выучить к», «Задать»;
  - groups that already have the deck are not offered again; a deck taken back is.
  
  The window loads the deck and the learner's groups itself, so any screen can open it
  (`GiveDialog`).
- **In the editor:** a small button on the «Новые карточки» card, beside its title, where the
  cards are made. Once given it reads «В группе «7Б»» (or «В группах: 2») with a check, and still
  opens the window. The old section at the bottom is gone.
- **On a deck's own page:** a quiet icon beside the title and the rename pencil, only for my own
  deck with words, and only if I own a group. No new row on the page; the «Изменить колоду» row no
  longer mentions groups.

## Consequences
- Giving a deck is two taps from either screen, and no longer needs scrolling.
- Only the group's owner can give (unchanged); others never see the button.
