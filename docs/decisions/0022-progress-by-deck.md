# 0022 — Progress by deck; a day kept with every review done

**Status:** Accepted. Amends the plan-day rule of ADR 0015 and ADR 0016 (spelling leaves the
day); replaces the course-words figure on «Прогресс» (ADR 0021's open question).

## Context
With own decks, group decks and course levels side by side, «Прогресс» still measured the course's
words against its 1,300-word goal. The day rule (new words at the pace, then spelled) could not be
met once a learner had no new words left, and said nothing about reviews — the part of spaced
repetition that actually builds memory. The account actions sat on «Прогресс» without being
progress.

## Decision
- **«Прогресс» answers two questions.** «Знания»: how many words I've learned, in all and deck by
  deck — my own decks, my groups' decks and the course levels I've started — each row with its
  percentage and a three-tone bar (known well / learned / met). A row opens the deck's page.
  «Регулярность»: the week against my promise and the calendar, as before.
- **«Выучено» is evidence of memory, not exposure:** a word recalled in a later review (reviews
  come a day or more after meeting it) with any answer but «Снова». «Надёжно»: FSRS stability of
  21 days or more. Totals count a word once, however many decks hold it.
- **A day is kept** when a study lesson was finished with no review left due across all decks,
  and the day's new words met the pace. The target already drops to what is left to learn — now
  counted over every deck I study — so with nothing new left, cleared reviews keep the day.
  A finished study session records the reviews still due (`learning_sessions.reviews_left`);
  sessions from before it was recorded count as cleared, so history is not rewritten.
- **Spelling is practice**, offered after a lesson, no longer part of the day.
- **«Аккаунт»** (sign out, delete my data) moves to the end of «Мой профиль».

## Consequences
- The week, weeks in a row and the group board follow the new rule without other changes.
- A learner with many decks must clear all their reviews for the day to count; the lesson summary
  says so («Остались повторения в других колодах»).
- The course goal figure leaves «Прогресс»; the course screen keeps the levels' counts.
