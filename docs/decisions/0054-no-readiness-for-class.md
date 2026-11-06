# 0054 — Nobody is told who keeps up with a deadline

**Status:** Accepted (the owner's request, 6 November 2026). Replaces ADR 0030's statuses on screen and its point on «К уроку» in ADR 0032 and 0039.

## Context
The group's page had a section «К уроку»: «travel к 13 ноября: успевают 0 из 4», then each student by name with «ещё не начато, отстаёт на 2 слова». The owner decided the app should not show this.

## Decision
- **«К уроку» goes** from the group's page, for the owner and for students, with its «Учить» button. A deck is studied from its own page.
- **The same fact goes wherever else it appeared:** the red «отстаёте на N слов» under a group's name in the list of groups, and «Готовы N из M» in the owner's notification on the deadline day.
- **The server stops sending it:** `on_track`, each member's counts on an assignment (`members`), `behind_for_class`, and the `see_standings` right.

## What stays
- Deadlines themselves: the date on a deck, its even spreading over the days (ADR 0028), «до срока 2 дня, осталось 4 слова» on a deck's card.
- A learner's own line in the deadline day's notification, «осталось 6 слов» or «вы готовы»: their own words, nobody else's. `my_standing` remains for that alone.
- A friend's words in the group's report (ADR 0052), which say how far along someone is without judging it against a date.

## Consequences
- A teacher no longer has a one-line answer to "who is ready for the lesson"; they read it from the words on friends' cards.
