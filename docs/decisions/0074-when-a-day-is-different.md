# 0074 — When a day is different: the plan bends instead of breaking

**Status:** Accepted (the owner's request, 20 November 2026: «how to handle the unforeseen circumstances that disrupt
the schedule»). Builds on ADR 0071–0073.

## Decision
- **The calendar knows dates.** A block can be on one date only (`schedule_events.on_date`; its weekdays hold that
  date's weekday, so older apps still read it), and a repeating block can be off on one date (`schedule_skips`). The
  coach plans each date from its own blocks (`blocks_on`); study times are still found in the repeating week.
- **«Сегодня не получается»** offers three ways out, each shown as before → after: **5 minutes** of the most
  important task as soon as there is room; **later** — the whole plan from a free time at least an hour on; or
  **tomorrow** — today off, tomorrow at its usual load, never doubled. The choice is kept for that day
  (`mentor_day_overrides`) and can be undone.
- **Never miss twice.** After a promised day is missed (once a study time was promised for it), today says so
  gently and offers 5 minutes; the day's reminder says «Вчера не получилось — сегодня важно. Даже 5 минут
  считаются.» When the study time has passed with nothing done, the home offers 5 minutes now.
- **In the chat**, «завтра нет школы», «в субботу концерт», «болею», «поездка» become a card (`propose_exception`):
  skip a block that day (named loosely, so Russian endings match), add a one-off, or pause the promise (at most 31
  days). Nothing changes until the tap. Answers end with **quick replies** (`offer_replies`), shown as chips. The
  same activity offered twice in one answer is shown once.
- **Reminders run**: `.github/workflows/reminders.yml` every 15 minutes with the cleanup's secrets (the server
  sends each kind at most once a day).
