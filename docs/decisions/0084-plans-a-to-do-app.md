# 0084 — «Планы»: a simple to-do app in place of the mentor

**Status:** Accepted (the owner, 24 November 2026: «I am not even sure whether we need mentor chat. It is useless. I
learned it from TickTick … a simple to do app … studying at 21.00 like a recurring task … the UI and the logic of the to
do app must be way more realistic pleasant just like TickTick»). First of three steps: personal tasks here; a group's
tasks and Friends next (0085); the study task as the promise after (0086).

## What TickTick does that we take
From its App Store page, blog and features page (its screenshots could not be viewed: the browser extension was
offline):
- a Today list with overdue tasks first;
- quick add from «+» that understands typed dates («tomorrow 8 am»), with a tap to keep a found word as text;
- four priorities;
- repeats, where an edit applies to this one, this and the following, or all;
- swipe actions;
- «Upcoming»;
- an inbox for tasks with no date.

We take the behaviour, in the app's own look; nothing of TickTick's branding.

## Decision
**A «Планы» tab for everyone.**
- **Today:** a week strip (seven days from today, a dot where something is open); «Просрочено» on top with «На
  сегодня»; the day's tasks (timed ones by time, then by priority); «Выполнено · N», folded.
- **«Предстоящие»** (the next seven days) and **«Входящие»** (no date).
- **A row:**
  - a round box in its priority's colour, the title, and time / repeat / overdue date;
  - tap the box to tick it («Выполнено · Отменить» for 4 s);
  - swipe right to tick, swipe left for «На завтра» and «Удалить»;
  - tap the row for its details.
- **Quick add:** one line, in Russian and English. «Английский каждый день в 21:00» becomes the title «Английский»,
  daily, at 21:00. What was found shows as chips, and a tap keeps one as text. Under it are buttons for date
  (quick days, a month, a time, a repeat) and priority; Enter adds the task and the line is ready for the next.
- **Details:** title, notes, date/time/repeat, priority, «Пропустить этот день», «Удалить». A repeating task asks
  «Только этот день / Этот и следующие / Все».

**The mentor's tab is hidden** (`MENTOR_TAB`, off; its code, data and API stay, and the switch brings it back). The e2e
server turns it on, so its tests still run.

**Data:**
- `tasks` holds a learner's task, or a group's (for 0085). It has a date (null: inbox), a time, a repeat as a weekday
  mask from its date until `repeat_until`, a priority, and a kind (task | study).
- `task_marks` holds done or skipped, per task, learner and day.
- A one-off past its day and not done is overdue until done or moved. A repeat's missed days are not piled up: each
  day is its own.
- «Этот и следующие» ends the series the day before and starts a changed one, moving later marks with it.
  «Только этот день» skips that day and makes a one-off for it. The past never changes.
- **Times and days** are the learner's own (the request's time zone).
- **Saving:** online first. The screen changes at once and saves behind, one save after another in the order made. A
  failure says so and shows the server's state.

**Phones:** the bottom bar now has four tabs. On a narrow phone a long name gets a little smaller and ends in «…»
rather than pushing the page sideways («Жыйынтыктар» at 320 px).

## Later
- **Reminders** at a task's time: push keys aren't set on production, and the Reminders job is paused.
- **Offline**, through the outbox.
- **Groups' tasks and Friends** (0085).
- **The study task as the promise**, ticked by practice (0086).
