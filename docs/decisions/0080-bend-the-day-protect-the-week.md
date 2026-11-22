# 0080 — Bend the day, protect the week

**Status:** Accepted; replaces the «Сегодня не получается» part of ADR 0074 (the owner, 20 November 2026: «working
incorrectly, timezone wise, and the logic is really terrible»).

## What was wrong
At 14:25 with a 21:00 plan, «Позже» offered 15:30 (earlier than planned: options counted from now); «Перенести на
завтра» moved nothing; the day ended at a fixed 22:00, so an evening learner got no «later»; «Было» showed the plan
from now, not as planned; today's plan used the study time that starts tomorrow; and today's choice carried no date,
so a page left open past midnight, or the copy kept for offline, applied yesterday's choice to today.

## Options considered
Snoozing single tasks (Todoist), automatic re-planning (Motion, Reclaim), a streak freeze (Duolingo), the 2-minute
rule and «never miss twice» (habit research), rolling unfinished tasks over (Sunsama), adaptive weekly load
(TrainingPeaks), «remind me later» with a time picker (Headspace), dragging on a timeline (Structured), saying it to
the assistant (our chat), and a weekly budget instead of daily rules (Beeminder).

## Decision
Three honest choices, each one line saying what happens:
- **Только 5 минут** — the most important task, at the planned time if it is still ahead, else now. After a missed
  day it is marked as the one to take (never miss twice).
- **Другое время** — up to four real free times today for the whole plan, before or after the planned time, up to
  bedtime; or the learner's own time.
- **Сегодня отдыхаю** — nothing today, and said so: words due wait for tomorrow, the week's targets spread over the
  days left; no day is doubled.

And: «today» from the server carries the learner's local date, and the app ignores (and reloads) a «today» that is
not the device's date; today keeps today's own study time; the study day ends at the sleep block, else 23:00. The
chat stays the way to describe anything more complicated.
