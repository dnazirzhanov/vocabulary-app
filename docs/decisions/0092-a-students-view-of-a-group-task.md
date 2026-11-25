# 0092 — A student's view of a group task

**Status:** Accepted (the owner, 25 November 2026: «when a student pressed on the task to see what kind of it is,
they can't do that now … make the tasks viewable, so that the student knows what task, which days, and the student
progress on that task … not too much info … just sufficient»).

## Context
A group's task (ADR 0085) is the teacher's. Tapped in «Планы», it opened the edit form with every field switched
off: it read like a broken form. On the group's page a student saw every classmate's week on it.

## Decision
- **In «Планы», a tapped group task opens a view, not a form.** It has four parts, and nothing more:
  - **What:** the group it is from («Задача группы 7Б»), the title, and the teacher's notes, if any.
  - **When:** the time and the repeat in words («19:00 · Пн, Ср, Пт»), and for a repeat, the seven weekdays with
    its days lit.
  - **My week:** this week's days as dots, the same marks as the group's page: done, skipped, missed, still to come,
    and «not that day». Below them is «Сделано: 1 из 3», counting the task's days so far, today included.
  - **One action:** «Отметить выполненной», or «Вернуть» to take the tick back. A repeat can also be skipped today.
    A study task ticked by practice has no button: practice does it.
- **Ticked from the view, there is no «Отменить» notice,** since «Вернуть» is right there. The tick still sparkles
  and sounds as in the list.
- **On the group's page, a student sees only their own row;** the teacher still sees everyone's. Others' progress is
  the teacher's to follow, not classmates'.
- **A student's own tasks still open the edit form.**
