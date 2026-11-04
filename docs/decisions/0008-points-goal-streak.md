# 0008 — Points, daily goal and streaks reward evidence of learning

**Status:** Accepted

## Context

The brief asks for points for meaningful activity, a modest daily goal and encouragement for
consistency — while rewards stay subordinate to learning and never pay for endless guessing,
repeated trivial sessions or inflated metrics.

## Decision

- **Points are written once, with the attempt that earns them** (`review_attempts.points`), by one
  pure rule (`services/progress.py`):
  - meeting a new word: **10**
  - a word recalled in a scheduled review: **20** (the strongest evidence: production after a delay)
  - a word missed in a review: **5** (reviewing still counts, less)
  - everything else, including all practice-session answers: **0**
- Because each exercise has exactly one stored attempt, points cannot be double-counted, and
  because practice earns nothing, repeating easy material cannot farm them.
- **Daily goal: 30 points** — about one new lesson or a short review. A pilot hypothesis.
- **Streak:** consecutive local days with the goal met, counted back from today — or from
  yesterday until today is over, so a streak never looks broken in the morning.
- Days are the learner's local calendar days. The browser sends its IANA time zone
  (`X-Time-Zone`); PostgreSQL buckets attempts with `timezone(zone, answered_at)`, so daylight
  saving days are 23 or 25 hours long as they really are. An unknown zone falls back to UTC.
- The progress view shows delayed recall ("вспомнили на повторениях за 30 дней") rather than a
  generic correct-answer rate, which would count answers given moments after seeing the word.

## Consequences

- Changing point values later affects only new attempts; history keeps what was earned.
- No leaderboard or social comparison exists; those are P1 and need their own decision.
- If learners treat the goal as a ceiling or find it too easy or hard, the constant changes
  without a migration.
