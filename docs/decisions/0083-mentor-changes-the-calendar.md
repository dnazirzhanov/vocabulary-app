# 0083 — The mentor changes the calendar itself

**Status:** Accepted (the owner, 21 November 2026: «users should be able to just say what their schedule is, and the
mentor should make a tool call and change the calendar accordingly … when the user says how my schedule looks like,
the mentor should … show the calendar of today»). Changes ADR 0072's «nothing is saved by a tool» for the calendar
only.

## What was wrong (production chats, 20–21 November)
- «Школа пн–пт 08:30–13:30» became a card to confirm; nothing was saved until a tap, and a tap on an old card in a
  reopened chat could add the week twice.
- «I sleep from 23:00 up to 7:00. Put it into the calendar»: the mentor refused, saying the app adds sleep itself
  (false). The tool had no sleep kind, and 23:00–07:00 crosses midnight, which a block cannot.
- «What is my schedule?» was answered in text from `what_now`; the day's timeline (ADR 0077) was never shown.

## Decision
- **`set_schedule` saves at once.** `add` blocks (any kind, sleep, rest and play included) and `remove` blocks by
  title (on some days or all). Its card lists what changed (+ added, − taken off) with «Отменить».
  - A block past midnight is saved as two: until 24:00 on its days, from 00:00 on the days after. The card shows them
    as the one night the learner said.
  - A block with the same title as an existing repeating one, at an overlapping time, replaces it on those days only:
    saying the week again never doubles it, and «в пятницу школа до 12» leaves Monday–Thursday as they were.
- **`change_day` changes one date at once:** a usual block off (skip) or something extra (one-off), with «Отменить».
  A pause from studying stays a card to confirm (`propose_exception`), since it changes the learner's promise.
- **Undo** (`POST /mentor/schedule/undo`) restores exactly what the change touched: deletes the blocks it made, puts
  changed or removed blocks back, takes its skips off. It only touches the learner's own blocks; undoing twice changes
  nothing more.
- **Asked about the schedule** («what is my schedule», «как выглядит мой день», «а завтра?»), the mentor calls `show`
  with the day component (a date for another day). The prompt says so, and never to list it in text.
- Goals, study times, pauses, reminders and remembered facts are still saved only on a tap.

## Also fixed: two races when the mentor opens on the last chat (the mentor layout change, PR #136)
- The chat list arriving after a question was sent «reopened» the chat just begun over the answer being streamed,
  leaving the empty start screen. The list no longer reopens a chat once the learner has sent something.
- The last chat's messages arriving after a question was sent replaced the screen with the old messages: the new
  question and its answer vanished. A load that is out of date (a question sent, another chat opened) is ignored.
Each has an e2e test that fails without its fix.

## Limits
- Matching is by title: «Школа» and «School» are different blocks. The prompt tells the model to reuse the existing
  title (`get_calendar` shows them).
- Undo after the learner edited the same block by hand puts the mentor's «before» back over that edit.
- A block taken off entirely loses its future skipped dates; Undo brings the block back without them.
