# 0078 — Knowing whether the mentor works

**Status:** Accepted (the plan approved on 20 November 2026, step five of five).

## Decision
- **Little new recording.** The learner's timeline (ADR 0075) already holds goals, study times, rescues, pauses and
  decisions; practice is already recorded. A new `mentor_events` table holds only what is missing:
  - `chat_message`, written by the server after each answer: time to the first visible piece and to the end, the
    tools used, and token use across rounds (prompt, answer, and how much of the prompt the model's cache served);
    each is also logged;
  - `start_tapped`, the only event the app sends: which kind of practice, and where (home, chat card, the plan beside
    the chat). Sending it never waits and never retries; if it fails, the practice starts anyway; offline it is
    simply lost (it does not use the outbox).
- **Weekly metrics** (`app/services/mentor_metrics.py`), from all of the above: promised days kept (each learner's
  own days), practice minutes per learner, «Начать» → finished practice within 90 minutes, answers with median
  timings and cache share, rescues by choice, facts saved from the chat, and D7/D30 retention of each week's new
  mentor users once those days have passed. `GET /api/internal/mentor-metrics` (the scheduler's secret) and
  `python -m app.cli mentor-metrics`.

## Not done: reordering the prompt for the cache
DeepSeek caches a prompt's shared beginning, and our prompt begins with the learner's local time, so almost nothing is
shared. Moving the time to the end was tried and reverted: the time comes first on purpose (ADR 0072), to fix the
mentor stating the wrong time, and a test holds it there. Moving it needs evidence that the time is still stated
correctly (`evals.run --live time-now`) and the real cache share, which `chat_message` now records. Decide with
both in hand.
