# 0044 — Old answers give way, and a full server says so

**Status:** Accepted. Measurements in `docs/research/capacity-2026-11.md`.

## Context
A load test with 1,000 synthetic students and 180 days of history, at a free host's 0.1 CPU, found:
the database at 871 MB against a 500 MB limit, mostly answers and stored lesson plans; and a server that
past about 5 requests a second stopped answering anybody, because abandoned requests kept running.

Simply deleting old answers would have broken the app. The «знаю» count, the friends' word bars and which
decks count as started were all computed from every answer ever given.

## Decision
- **What the screens need is kept apart from the answers:** `user_word_progress.first_recalled_at`,
  written as it happens and backfilled by the migration, and `study_day_totals`, one row a day for the
  calendar and the promise.
- **A finished lesson gives up its answers and plan after 35 days,** longer than anything reads them (the
  recall rate reads 30). Its row stays: it says the deck was started. Totals go after about 400 days, past
  what the calendar shows. Unfinished lessons are left alone, since they can be resumed.
- **It runs nightly, from outside:** `POST /api/internal/cleanup` with the scheduler's secret, in
  transactions of 500 lessons. It can stop at any time, and a second run counts nothing twice.
- **A day's total is fixed in the learner's zone** at the time. A group in another zone may see a day older
  than 35 days shifted by a date. Nothing recent is affected.
- **A test compares every screen before and after cleanup,** and each thing it protects was checked by
  breaking it on purpose.
- **Past 20 requests at once the server refuses at once** with `server_busy`, before anything has run, so
  any request is safe to send again. The app retries three times after 1–3 random seconds. Health checks
  always pass, or a host would restart the server at the worst moment. 20 was measured: 12 turned too many
  away at 30 students, and no limit gave 60 students nothing.
- **The friends screens read only the days they show,** not a year (240 KB to 42 KB). The board's
  `streak_weeks` goes: no screen has shown it since ADR 0039, and only it needed the year. It also stops
  breaking ties for a place, which no screen shows either.
- **`openai` is imported only when drafting:** it was half of start-up.

## Consequences
- A nightly scheduler is now required, not just for reminders (`deploy.md`), so `REMINDERS_TOKEN` is too.
  Without it the database fills up in months.
- History beyond 35 days can't be re-analysed answer by answer. If per-answer analysis is ever wanted, the
  window must grow first.
- At overload students see «Сейчас занимается очень много учеников» on some requests. That is the honest
  limit of one small server, and it's better than nobody getting an answer.
- Database traffic may still pass the free 5 GB a month, and nothing has been measured on a real host.
