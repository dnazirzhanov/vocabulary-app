# 0051 — One button for a deck's words; no sentence about a deadline

**Status:** Accepted (the owner's request, 6 November 2026). Goes further than ADR 0038 on the same page.

## Context
On my own deck's page, «Все слова колоды» and «Изменить колоду» sat one above the other, leading to two views of the same
words. And a deck with a deadline had a tinted box, such as «Выучить к 13 ноября. Вашего темпа хватает, чтобы успеть с запасом
на повторение.» The owner asked for one button and for such messages to go, because they are visual noise.

## Decision
- **One button.** The deck's page keeps «Все слова колоды». On my own deck, the words' page has «Изменить колоду» under its
  title, the same small button as «Дать группе». «Назад» from the editor returns to the words, with the title as it now stands;
  deleting the deck goes home. Nobody else's deck shows the button.
- **The row hints at it on my own deck:** «С прогрессом · добавить и поправить», so a deck's author can find where to add cards.
- **The pencil on «Мои колоды» stays,** as the short way straight to the editor.
- **The deadline sentence goes, in all its forms,** with its helper (`deadlineNote`).
- **«Напомнить в 17:00» goes with it,** since it lived in that box. Notifications stay in ⚙ and in the first-run question
  (ADR 0042), and their choice «Срок колоды» works as before.

## Consequences
- A deadline still shapes the day: the button says today's share («Начать урок · 2 слова»). The date itself shows on «Мои колоды»
  («до срока 2 дня, осталось 4 слова»), and on the group's page.
- The window for changing the daily pace still says «До срока сегодня всё равно N слов» when the learner picks fewer, since
  otherwise their choice would seem to be ignored.
- A student who hasn't turned on notifications is no longer offered them at the moment a deadline matters.
