# 0015 — Plan days: consistency against the learner's own promise

**Status:** Accepted (the day rule amended by ADR 0016, then ADR 0022). Supersedes the daily goal
and streak of ADR 0008; amends the ranking of ADR 0011.

## Context
A "consistent day" was 30 points everywhere: the friends board (ranked by such days, ties broken
by points), the Progress calendar, the streak and the lesson summary. Points grow with volume, so
the board rewarded whoever had more time or took bonus lessons, and nobody could tell what made a
point. The owner wants consistency measured against each learner's own promise — e.g. "4 days a
week, 20 words a day" — and extra learning recognised in a profile, never on the board.

## Decision
- **A plan day** is a day with study answers and at least that day's target of new words met.
  When the app allowed no new word that day (too many reviews due, or every word met), the plan
  was the reviews: a finished study session makes the day. Practice («Трудные слова») is never
  part of the plan.
- **The day's target is recorded** on each study session when it starts (`day_target`: the
  effective target with the warm-up, capped by the words left in the course; 0 when no new word
  is possible), with the days a week promised (`promised_days`). Past targets were not stored
  anywhere, so this is the only honest source. If the target changed during a day, the smallest
  counts — the smallest plan the app gave you.
- **The week** counts plan days against the promise. Days beyond the promise add nothing; the
  result is the share kept, `min(plan days, promised) / promised`. A promise changed mid-week
  applies from the next week (the week's first study session holds it).
- **Board:** ranked by that share; equal shares share a place. Points are gone from every
  response. The shared goal counts each member's planned words, at most their week's plan.
- **Streak:** weeks in a row with the promise kept. This week counts once kept and never shows a
  streak as broken before it ends; promised rest days never break it.
- **Extra** (profile only): new words beyond each day's target, and practice answers.

## Consequences
- Points stay in the database: an introduction is recognised by its points, and the column keeps
  the history. They are no longer shown.
- Sessions from before this decision have no recorded plan; their days use the learner's current
  settings, with the warm-up of that day. A learner who has since changed their target sees those
  old days judged by the new one.
- A session that runs past midnight carries the day it started on as its target; its words count
  on the day they were answered.
- A study session started in a different time zone than the stored one is counted in the zone
  the browser sends; starting a session updates the stored zone.
