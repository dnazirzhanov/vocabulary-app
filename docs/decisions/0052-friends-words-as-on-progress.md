# 0052 — A friend's words as on «Прогресс»

**Status:** Accepted (the owner's request, 6 November 2026). Replaces the bar and figure of ADR 0039's point 3.

## Context
Each friend's row on the group's page showed «12 / 30», counting only words learned: recalled in a review a day or more
later. So a student who had kept their promise and met every word of the deck still read «0 / 30». The owner found this
strange, since «Прогресс» says the same thing clearly: words met, then «знаю · учу · впереди».

## Decision
- **The figure counts words met,** «5 / 12», as on «Прогресс». «Знаю» keeps its meaning (ADR 0022), so nothing about learning
  changed: the server already sent both numbers, by the same rule, and a test now holds the two pages to the same numbers.
- **Each friend is a card like a deck's on «Прогресс»:** name and figure, the bar, «знаю 2 · учу 3 · впереди 7», an arrow.
  «Пропусков: N» takes its own line. My own card keeps its tint.
- **One component** (`progress/WordStages`) draws the figure, bar and stages on «Прогресс», on friends' cards and in a friend's
  window, so they can't drift apart. Parts at zero are left out everywhere, as on «Прогресс».
- **The legend's colour samples go:** every card now names its stages in words. «Слова из «Unit 4»» stays, once, above the lists.

## Consequences
- A card is taller than the row it replaces, so a class of 30 scrolls further. Friends stay alphabetical, unranked.
- Comparing friends by the figure now compares words met; the bar's strong part still shows words known.
