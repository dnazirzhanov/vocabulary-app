# 0010 — A course goal with a sourced number, and a pace the learner picks and the app tunes

**Status:** Accepted

## Context
Pilot feedback: learners could not tell what the deck would get them, and a fixed 5 words per
lesson suits nobody — some learners want 3 words a day, some 100. People also overestimate how much
they will keep up with, and a missed self-set goal feels like failure; fast learners must not be
slowed down either. The product's job is to remove uncertainty: what to learn, how much a day, and
when it ends.

## Decision
**Course goal.** Each deck may carry a `course_goal` (`target_words`, `coverage_percent`, `source`);
the validator refuses numbers without a source. The starter course promises *about 1,300 words ≈
about 80% of the words in everyday text*, computed from the NGSL 1.2 frequency data
(`docs/research/ngsl-coverage-2026-10.md`, `content/tools/ngsl_coverage.py`). The copy promises
certainty about the process (what, in which order, when you finish), never fluency.

**Pace** (`services/pace.py`, mirrored for display in `web/src/lib/pace.ts`):
- The learner picks new words per day (presets 3 / 5 / 10 / 20 named by time — Спокойный, Обычный,
  Быстрый, Интенсив — or any number 1–100) and study days per week (for the roadmap).
- **Cost shown from first principles.** A new word takes 3 exercises; each of its ~5 Leitner reviews
  takes 2. Daily minutes ≈ words × 13 exercises × the learner's median seconds per exercise (10 s
  until there are 20 measured gaps; gaps over 2 minutes are breaks). From 20 words a day the screen
  states the cost "через месяц" before the learner commits.
- **The target is a plan, not a cap.** Lessons are sized by what is left of today's target (at most
  10 words each); after it, bonus lessons of 5 stay available.
- **Ramp.** Targets of 10 or more start at 50% in the first week and 75% in the second (on by
  default, can be switched off), counted from onboarding.
- **Review-debt throttle — the only brake.** New words wait while due reviews reach
  max(20, 2 × 5 × target), about two days of reviews at that pace. Reviews never wait.
- **The streak stays tied to the 30-point daily goal**, not to the word target, so an ambitious
  target that is missed never breaks a streak.
- **Suggestions, never silent changes**, from past days only (today is in progress), not during the
  ramp, not when the deck has no new words left, and silent for 7 days after a dismissal:
  - *lower* to the learner's actual average when 3 of the last 5 learning days missed the target;
  - *lower* to 70% when recall in reviews is below 60% (at least 20 reviews in 30 days);
  - *raise* by ~30% when the target was met on 5 of the last 7 days with recall ≥ 85% (at least 10
    reviews) and no review debt.

**Roadmap** (`web/src/lib/roadmap.ts`, pure and tested; redrawn live as the pace changes):
- New words on study days only; rest days come from the weekend first; today always counts.
- Two dates: the last new word of the deck, and "хорошо помните все" — a word counts as well
  remembered after three on-time successful reviews (stage 4: 1, 3 and 7 days), each done on the
  first study day it falls due. Words met before today are treated as met today (never optimistic).
- Weekly rows (with the ramp's lower targets), month-end totals, and a projection of the whole
  course at the same pace, labelled as such because the course is still being written.
- **The plan counts toward the course goal** (1,300 words), not the 30 words written so far, and
  each calendar day shows one number: the words known by the end of that day if the pace holds
  (10 known at 20 a day → 30, 50, 70…). The screen says that the rest of the course is still
  being added.
- **«План» is its own screen**, opened from a home card («1 300 слов — к 8 января») and the top
  bar. It puts the goal date first, then the pace controls (words a day, days a week, warm-up),
  then a calendar that redraws as the pace changes; saving is a separate, explicit step.
- **The calendar shows five weeks at a time, starting with this week** (Monday first), so it
  never opens on empty past weeks. The 1st of each month names its month, rest days keep the
  previous total in grey, a green dot marks a round number reached (50, 100, 250…), and the
  goal day is orange with a flag. A milestones strip lists those dates. Every cell has a full
  text label for screen readers.
- History: a line chart, then a per-month calendar showing new words per day, were replaced
  after owner feedback — learners plan by dates and running totals, not curves or increments.

## Consequences
- All thresholds are pilot hypotheses; they live as named constants in one module with tests.
- Users who have not chosen a pace get 5 words a day without a ramp, which is what lessons were
  before; the first-run screens appear until a pace is saved (`users.onboarded_at`).
- The starter deck predates the NGSL goal: 4 of its 30 words are outside the top 1,300 and are to
  be reviewed with the Russian translations.
