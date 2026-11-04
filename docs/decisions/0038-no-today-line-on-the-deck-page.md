# 0038 — A quieter deck page: no «today» line, no «Ваша колода»

**Status:** Accepted. Supersedes the one-sentence «today» line of ADR 0035.

## Context
After ADR 0035 a deck's page still said, in a sentence under its progress bar, what the day held:
«Сегодня 4 слова на повторение.», «Сегодня 5 новых слов.», «На сегодня всё. Можно взять ещё слов.»
The button right below says the same («Повторить · 4 слова», «Начать урок · 5 слов», «Ещё 5 слов»).
The owner asked for such text to go.

## Decision
- The sentence goes, in all its forms, with its helper (`deckToday`).
- What stays on the page, top to bottom: the title, the progress bar with «знаю · учу · впереди»,
  «В день: N новых слов · Изменить», the quiet links, and the one button, which carries the day's
  content in its label.

- **«Ваша колода»** above the title goes too: on my own deck it says nothing new. The line stays
  where it tells something: a course level's («A1–A2») and a group's deck's («от Ольга · 7Б»).

## Consequences
- The page no longer says when the next review is («Следующее повторение — завтра»), nor, for a
  deck whose lesson is open, that it is waiting; the button reads «Продолжить урок».
- A locked course level can't be opened from the course list, so its explanation was never seen
  there; it goes too.
