# 0035 — A deck's page: today in one sentence, no blocking, rename in place

**Status:** Accepted. Refines ADR 0014 and 0020 (the deck page's Anki counts) and ADR 0026's
one-open-lesson rule.

## Context
The owner found the deck page noisy:
- «Сегодня в колоде» showed three numbers («Новые 0 · Изучаемые 0 · К повторению 1»).
- It added «Сначала закончите начатый урок в колоде «gg»», which blocked studying here until a
  lesson elsewhere was finished.
- The daily number of new words was hard to see.
- Renaming a deck was only possible in the editor, by clicking a title styled as plain text.

## Decision
- **Today in one sentence** (`deckToday`): what the button brings, or why nothing.
  - «Сегодня 5 новых слов и 1 на повторение.»
  - «Сегодня 1 слово на повторение.»
  - «На сегодня всё. Можно взять ещё слов.»
  - «На сегодня всё. Следующее повторение — завтра.»
  - «Сначала повторение: 40 слов…»
  - For a locked level, what opens it.
  
  The three counts go from this page.
- **The daily number under it:** «В день: 5 новых слов · Изменить», with «· пока 3, разогрев»
  during the warm-up and «· для всего курса» on course levels. The old separate warm-up line goes.
- **No «finish the other lesson first».** Starting a lesson in a deck while one is open in another
  deck sets the other aside (`learning_sessions.set_aside_at`):
  - it is no longer open, and it is never counted as finished, so it gives no study day;
  - its answers stay.
  
  Starting again in the same deck still resumes. A lesson open here shows «Урок начат —
  продолжите с того места, где остановились» and «Продолжить урок».
- **Rename in place:**
  - My own deck's page has a pencil beside the title; it opens an input with «Сохранить» and
    «Отмена».
  - The editor's title field shows a pencil and an underline, so it reads as editable.

## Consequences
- Migration `0a04b4717094`: `set_aside_at`; the one-open-lesson index now excludes set-aside
  lessons. The downgrade closes set-aside lessons.
- A learner who hops between decks leaves set-aside lessons behind. Their cards come back as due
  reviews as usual.
