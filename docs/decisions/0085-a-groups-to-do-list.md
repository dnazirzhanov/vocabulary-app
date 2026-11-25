# 0085 — A group's to-do list, tracked in «Друзья»

**Status:** Accepted (the owner, 24 November 2026: «teachers setting up a study program for a group be like setting up a
to do list for them, and then on the Friends section, the teacher can track whether ppl are doing the promise or
not»). Builds on 0084.

## Decision
- **The teacher sets tasks** on the group's page, in «Задачи группы» → «Задача для группы»:
  - the same one-line quick add as «Планы»: «Повторять слова каждый день в 19:00», «Эссе в пятницу»;
  - a task belongs to the group (`tasks.group_id`), and a new `manage_tasks` right is the owner's alone.
- **Every member sees it in «Планы»**, beside their own tasks, marked with the group's name:
  - they tick or skip it for themselves (their own marks), and that's all;
  - no editing, moving or deleting there (403; no swipe-left actions; the details are read-only).
- **The teacher edits or deletes it** for everyone.
- **Who did it:**
  - the group's page shows each task with «2 из 12 сделали сегодня»;
  - open it, and each student is named with seven dots for the group's week: done, skipped, not done, or not that
    task's day;
  - names, never an order of merit (as the promise report);
  - one student per row, with room around it and a fine line between rows, so a teacher can follow one student's
    week without the next row running into it (the owner, 25 November 2026).
- **The board API** carries `tasks`: each task with the week's days it falls on and every member's marks.
- **«Сегодня по обещанию» stays** until the study task becomes the promise (0086).

## Consequences
- Members see the teacher's tasks; the teacher sees each member's ticks on the group's tasks only, never their own
  tasks.
- A one-off group task done early counts on its own day.
