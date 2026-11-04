# 0025 — Anki's days and ordered intervals around FSRS

**Status:** Accepted. Refines 0012.

## Context

A check of the scheduler against FSRS-6 as published (`backend/tests/test_fsrs_math.py`) found
the maths exact, but two places where the `fsrs` library behaves differently from Anki, which
the app promises to follow:

- The library counts time since the last review in 24-hour periods and makes a review due at an
  exact moment. A card answered at 18:00 with a one-day interval stayed hidden until 18:00 the
  next day, and a review at 22:00 then 08:00 counted as the same day for memory.
- Anki makes each better answer wait at least a day longer than the one below it
  (`good.max(hard + 1)`, `easy.max(good + 1)`); the library doesn't, so for young cards
  «Трудно» and «Хорошо» could show the same «1 дн».

## Decision

In `services/scheduling.py`, around the unchanged library maths:

- **A study day starts at 4 AM in the learner's time zone** (Anki's default «next day starts
  at»; the zone the browser last reported, `users.time_zone`). Elapsed time given to FSRS is the
  number of study days between the reviews.
- **A card scheduled in days is due from 4 AM of that day**, so all of a day's reviews are there
  in the morning. Learning and relearning steps stay exact minutes.
- **Hard < Good < Easy**, a day apart at least, whenever both go to review in days. Only the
  interval is raised; stability and difficulty are FSRS's.
- The previews under the buttons show whole days for reviews, minutes for steps.
- Only learning steps come back within a session: a review due at 4:00, answered at 3:55, waits.

## Consequences

- The independent FSRS-6 spec in the tests models these rules too and still matches thousands of
  random histories; simulated recall at scheduled reviews stays at about 90%.
- Reviews due the same morning are ordered by word, not by the minute they were answered.
- Plan days, streaks and «сегодня» still change at midnight; only scheduling uses 4 AM.
