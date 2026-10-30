# 0030 — Who keeps up with a deadline

**Status:** Accepted. Builds on ADR 0028 (a teacher's «Выучить к»).

## Context
A teacher can give a deck a deadline, but the group page only showed how many words each student
had met. It didn't say who would be ready for the class.

## Decision
- **One rule for «on track».** The deck's words are due evenly from the day it was given to the day
  before the deadline (the deadline day is for review), as ADR 0028 spreads them. A member is behind
  by what they lack of that schedule up to *yesterday*: today is still theirs. From the deadline
  day on, every word was due.
- **Four statuses:** «все слова встречены», «успевает», «отстаёт на N слов», «ещё не начинал»
  (nothing met yet; on the first day that is not behind).
- **The teacher (the group's owner)** sees each member's status under their bar and a line «К 7
  ноября успевают 5 из 7 участников» (done or not behind).
- **A member sees only their own** («Вы встретили 6 из 12 · успеваете») and, in «Мои колоды»,
  «до срока 2 дня, осталось 6 слов». Never anyone else's: the group page stays co-operative
  (ADR 0017).

## Consequences
- The status is computed when the board is read; nothing new is stored.
- Days are the group's, in its time zone; a student far from it may see a day's difference at
  midnight.
