# 0028 — New words a day per deck, extra words for today, and a teacher's deadline

**Status:** Accepted. Refines ADR 0010 (the pace is per deck, not per learner) and ADR 0017 (a
group deck may carry a deadline).

## Context
The pace was one number per learner, chosen at onboarding and changed only by accepting a
suggestion. New words met in any deck used it up, so five words in one deck left nothing for the
next. Anki has a number per deck but hides it in options that are hard to find. A teacher usually
wants a deck learned before the next class, in two or three days, which a slow daily pace can't
promise.

## Decision
- **Each deck has its own new words a day**, shown on its page as «Новых слов в день: 10 ·
  сегодня 3 из 10», with «Изменить» opening an inline picker (− / number / +, quick 5–30).
  Course levels share one number, the course's (`users.daily_target_words`), so moving to the
  next level keeps it; the warm-up ramp and pace suggestions stay course-only. Own and group decks
  keep theirs in `deck_paces`; until set, they start from the course's number.
- **«Ещё слов сегодня»** takes any number of extra new words (up to 50 at a time) for today only.
  They are the deck's next words; tomorrow the usual number comes, from where they stopped. The
  quick «Ещё 5 слов» after the goal is met is the same thing.
- **A teacher's «Выучить к»**: the group's owner sets an optional date when giving a deck, and can
  change or remove it. Each member gets the words left (counted from the start of the day) in even
  shares over the days *before* the deadline, so the deadline day itself is for review; with one
  day left, or the date here or past, it is all of them. Recomputed daily, so falling behind or
  taking extra re-spreads the rest. A member's own higher pace still applies. A deck with a
  deadline is not held back by the review backlog: the date wins, and reviews still come first in
  every lesson.
- **Shown, never judged** (ADR 0027 stands): «Прогресс» lists today's «сегодня 3 из 10 новых» and
  the deadline on each deck; a day still counts with any finished session, and the friends board
  still ranks by words learned.

## Consequences
- One migration: the `deck_paces` table and `deck_assignments.due_on`.
- A learner with several decks can now meet more new words a day in total than before; the review
  backlog brake (ADR 0010) still holds new words back across decks without a deadline.
