# 0076 — Study, rest, play and priorities

**Status:** Accepted (the owner's request, 20 November 2026: «help users find the best times to study, do something
else, rest, play, and put priorities»).

## Decision
- **The kind of day** (`mentor_day_types`, one row per learner and date): a quiet question on the mentor's home,
  «Какой сегодня день?», answered with one tap and changeable. It sets how much the plan asks, cut from the end
  because the plan's order is its priority:

  | Day      | The plan asks                       |
  |----------|-------------------------------------|
  | ordinary, day off, not said | all of it          |
  | light    | about half, the most important first |
  | exam     | the five-minute minimum             |
  | sick     | nothing; no afternoon reminder; the next day is not told it missed one |

  Today's choice from ADR 0074 (minimum, later, skip) then bends that load.
- **Rest, play and sleep** are block kinds in the calendar. Like any block, the study times and today's slots never
  go there; the mentor's rules add that it defends them when a learner wants to give them up to study more.
- **Learning which times work:** each recent promised day (sick days and days skipped on purpose left out) is a try
  of its promised time. A candidate study time near a tried one is scored by the smoothed success rate
  (kept + 1) / (tried + 2), trusted more with more tries; after three tries with most kept, it says so:
  «получается в 6 из 8 раз».
- **The mentor sees** today's kind of day and today's real blocks (one-offs on their date, skips taken off: the
  prompt previously listed every block on the weekday).

## Not now
Placing essays and speaking in the learner's best-energy hours: the energy fact (ADR 0075) is in the prompt, so
the mentor can say it, but the plan doesn't place by it yet. A per-slot statistics table: the record is computed
from the last 28 days each time, which at this scale is cheap and never out of date.
