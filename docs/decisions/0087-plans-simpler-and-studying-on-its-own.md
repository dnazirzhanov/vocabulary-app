# 0087 — «Планы», simpler: any days, an end time, no inbox, and today's study worked out

**Status:** Accepted (the owner, 25 November 2026: «delete inbox … the options … weekdays and every day of the week, what
do you mean? … I wanna do it Wednesday and Saturday … a finishing time … users should not have a hard time of
figuring out what decks to study, and what spelling tasks to do … just show them in the to do app»). Amends 0084.

## Decision
- **No «Входящие».** «Планы» is «Сегодня» and «Предстоящие». A task is always for a day (the one being looked at, or
  typed); a task left from before with no date shows under today.
- **Repeat, plainly:** «Не повторять», «Каждый день», and the seven days as buttons, always in view. Tap Ср and Сб for
  «Wednesday and Saturday». The list says «Каждый день» or the days themselves («Ср, Сб»), never «по будням».
  Quick add understands several days: «по средам и субботам», «каждый понедельник, среду и пятницу», «every wednesday
  and saturday».
- **An end time, if wanted:** «с 19:00 до 20:00», «19:00–20:00», «с 7 до 8 вечера», «from 7pm to 8pm», or the second
  time box in the date sheet. It is after the start, on the same day; clearing the start clears it. Rows show
  «19:00–20:00». (`tasks.end_minute`, nullable: the running version is unaffected.)
- **«Учёба на сегодня», on its own:** at the top of today, the app lists what to study, from what it already keeps
  (offline too):
  - each deck with words to learn or review today («Учить «online-vs-offline-learning»» · новых: 5 · на повтор: 2 ·
    до 30 нояб. · 7Б), a teacher's deadline first, nearest first; then the course by level; then group and own
    decks;
  - each deck with spelling due («Правописание: «…»» · слов: 8).

  A tap opens that deck's page; «Назад» returns to «Планы». The list is today's work, not tasks to tick: once a deck
  has nothing waiting, it leaves the list.

## Consequences
- A learner's own tasks and the app's study list sit together on one screen; the promise (0086) still follows a
  repeating study task.
- Typed days and ranges are understood in Russian and English; other languages use the buttons.
