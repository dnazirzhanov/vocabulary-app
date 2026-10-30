# 0027 — No «план»: a day counts with a finished session; friends rank by words learned

**Status:** Accepted. Supersedes the day rule of ADR 0015, 0016 and 0022 (a «plan day»), and the
three rankings of ADR 0023.

## Context
«План выполнен» bundled three things: a lesson finished, every due review cleared across every
deck, and a daily pace of new words set once during onboarding. With several decks of one's own,
nobody remembered that pace or which deck it applied to, so «план 3» on a friend's row meant
nothing. The board ranked by days studied, then plan days, then weeks in a row, with tabs for
two other rankings: a rule that needed a paragraph. The owner found the leaderboard confusing.

What friends who compete want: one number explained in one sentence; a number that measures the
real goal (remembering words) and can't be farmed; a fresh start every week; and seeing what it
takes to pass the next person.

## Decision
- **No «план».** The word and the measure are gone. **A day counts when a session of any kind was
  finished that day:** a lesson, spelling or hard words. A card or two answered and left doesn't
  count; how much was done doesn't matter. The weekly promise («6 дней в неделю»), the week's
  circles, weeks in a row (🔥), the calendar and «Сегодня занимались» all use this one rule.
- **The new words a day stay a pace for the decks**, never something a day is judged by.
- **The board has one score: words learned** in the period — words recalled in a review a day or
  more after meeting them, any answer but «Снова» (the «Прогресс» definition, ADR 0022). Reviews
  come only on later days, so it rewards coming back, and tapping cards can't raise it.
  Ties go to days studied, then weeks in a row. Shared values share a place; a member who
  answered nothing in the period has no place and is named below the board.
- **One line explains it** above the board. No ranking tabs; days and cards are shown on each row
  as quiet statistics. Periods stay: week (default), month, all time.
- «Ваше место» names what passing the next member takes: «выучить ещё 14 слов», or, with as many
  words, the tie-break («ещё 1 день занятий»).

## Consequences
- The lesson summary no longer reports a day's plan; it carries only where spelling stands
  (its next-step button).
- `learning_sessions.reviews_left` is no longer recorded or read; `day_target` stays (the pace in
  force), but no day is judged by it. Old rows keep their values; no migration.
- A beginner can lead a week by reviewing faithfully; a heavy learner who stops coming back falls.
