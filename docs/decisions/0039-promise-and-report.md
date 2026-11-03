# 0039 — «Друзья» as a promise and a report

**Status:** Accepted. Replaces the weekly league of ADR 0032 and the ranking shown in ADR 0027 and
0023; replaces the «days a week» count of ADR 0015 with chosen weekdays. Reminders follow in ADR 0040.

## Context
The group page ranked members by words learned. The owner questioned it:
- A deck finished before its deadline can't be the measure.
- Consistency is a better basis, but any score invites tapping «Знаю» on every card to collect it.
- A leaderboard may belong to future Kahoot-like games, not to «Друзья» now.

The owner's own habit is the model: friends promise each other a task each day, remind each other
during the day, and report at its end. Feeling bad before friends when it wasn't done keeps them
consistent.

## Decision
«Друзья» becomes **a promise and a report**, not a ranking.

### The promise
- A learner promises chosen **weekdays** («Пн–Пт», «Пн Ср Пт», every day).
- A day is **done** when a session of any kind was finished that day (ADR 0027's rule).
- A day is **missed** when it was promised, is over, and nothing was finished.
- A change starts **tomorrow**, so today's record can't be edited after the fact.
  - A learner who has finished nothing yet (the first-run screens) has no past to protect, so it
    applies at once.
  - History is kept (`promise_changes`), so a change never rewrites a past month.
- A **pause** (`promise_pauses`) covers a holiday or an illness: from tomorrow, at most 31 days.
  Paused days are not promised, so they are never missed.
- `users.study_days_per_week` stays, equal to the number of promised days, and `PATCH /me` still
  accepts it: the old number is spread over the week (3 → Пн Ср Пт).
- Weeks in a row now means every promised day of the week was done. A paused week neither counts
  nor breaks the streak.

### The report (the group page)
1. **Today by the promise:** «3 из 6» members promised today who have done it; my own status, with
   «Заниматься» when it is still open; «Моё обещание: Пн–Пт · Изменить».
2. **«К уроку»** for decks with a deadline, unchanged (ADR 0030). Deadlines stay informational and
   are not part of the promise record.
3. **«Отчёт · ноябрь»:** one row per member, me first and then alphabetical, never by a score.
   - Seven dots for the week: ✓ done, an empty ring with a dash missed, a ringed ring today (still
     open), a faint ring a day to come, a small dot a day off. Shapes differ as well as colours,
     and nothing is red.
   - «пропусков: N»: promised days missed since the 1st of the calendar month, so the count
     restarts each month by construction. Counting starts the day after joining the group.
4. A row opens a **person's window:** their week, promise, misses this month, weeks in a row, and
   words **known** and **learning** (a two-tone bar). Words stay visible apart from the promise.
5. «Как это считается?» opens the rule.

Everyone in the group sees who kept the promise and who didn't. Only nicknames are shown, and the
wording is neutral in gender («ещё нет», «пропусков»).

The groups list shows «сегодня по обещанию 3 из 6 · вы ✓»; a deadline I'm behind on still takes
the line.

### Where the promise is set
- The first-run screen and «Прогресс» («Обещание: Пн–Пт · Изменить») and the group page open the
  same window (`PromiseDialog`) with a `WeekdayPicker`: seven toggles and two presets.
- The demo classmates joined at the start of the month so the report has days to show.

### Days
The report's days are the **group's** (its time zone), as the week already was. «Прогресс» uses the
learner's own. In a class in one zone they agree.

### The leaderboard
Gone from the UI. `rank` and `learned` stay in the board's data for future games; nothing reads
them now.

## Why this answers the gaming worry
- **There is nothing to win.** No points, no places. Pressing «Знаю» on every card buys only a ✓
  in front of friends it would be pointless to fake.
- **The record is personal and binary:** did I do what I promised today? Volume counts for nothing,
  so extra study buys nothing.
- **Honest limit:** nothing here can stop button-mashing. Spotting it by speed would mislabel
  quick, diligent learners and cost more trust than it earns, so we don't try. The known / learning
  bar shows real knowledge.

## API
- `GET /me` gains `promise {weekdays, pending, pause}`.
- `PUT /me/promise {weekdays}`, `PUT /me/promise/pause {until}`, `DELETE /me/promise/pause`.
- The board's rows gain `week_states`, `month_misses`, `promise_today`, `promise_weekdays`,
  `paused`, `known`, `learning`; the board gains `today`, `today_promised`, `today_done`. The
  groups list gains `today_promised`, `today_done`, `my_today` and drops `my_rank` and `ranked`.
- `GET /progress` returns `promised_week` (seven flags) in place of `promised_days`.

## Not in scope
- A peer «Напомнить» button, any ranking or points, and speed or effort checks.
- A promise set by a teacher for a whole group: it stays personal.
- Push reminders (ADR 0040).
