# 0032 — «Друзья» without the noise

**Status:** Accepted. Refines ADR 0023 (week only; one number per row) and ADR 0030 (the teacher
sees, by name, only who isn't keeping up).

## Context
A group's page had grown to about twenty pieces of information: a today strip, a period switch
and a rule paragraph, a «your place» card, rows with words, days, cards, a streak and week dots,
three «together» totals, the decks with group-wide counts and per-member bars, and housekeeping.
The owner found users bombarded and asked for only what matters most.

## Decision
The page answers what a member wants to know, in order:
- **competence:** where am I, and the one concrete next step;
- **the class:** am I ready;
- **relatedness:** am I not alone;
- **social comparison:** who is just around me.

1. **My week:** «Вы на 2-м месте» and «До 1-го — ещё 14 слов». One number to act on.
2. **«К уроку»,** only when a deck has a deadline.
   - A student: their own status and «Учить».
   - The teacher: «успевают 5 из 7», and by name only those who don't.
3. **«Неделя»:** a weekly league with a fresh start every Monday; the month and all-time views go.
   - Rows: place, nickname and words learned, plus ✓ for who studied today. That replaces the
     today strip.
   - Shown: the top 3, then me with the one just above and below.
   - «Как считаются места?» opens the rule.
   - A row opens that person's window: this week's words, days and cards, weeks in a row, and
     all-time words.
4. **«Управление группой»,** folded at the bottom: the group's decks, members and leaving.

The groups list shows one line per group: my place and how many studied today. If I'm behind for
a class, that deadline takes the line in red instead. The circles of members' initials go.

Third-person statuses avoid the gendered past tense («ещё не начато»): a nickname says nothing of
whether it is he or she.

## Consequences
- Removed from the page:
  - the «Вместе» totals;
  - group-wide deck counts;
  - per-member bars and «помнит N»;
  - days, cards, dots and streaks on rows.
- The figures stay one tap away in a person's window.
- A teacher no longer sees each member's progress on a deck without a deadline; with a deadline
  they see who isn't keeping up. If teachers miss the full table, it can return inside
  «Управление группой».
