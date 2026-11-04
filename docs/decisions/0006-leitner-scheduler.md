# 0006 — Leitner-style review scheduler

**Status:** Accepted

## Context
The brief asks for a simple, explainable, deterministic and unit-tested scheduler that returns
missed words sooner and spaces recalled words further apart, kept separate from UI and handlers.
It warns against an elaborate memory model before the basic loop is validated.

## Decision
- Five stages with fixed intervals: **1, 3, 7, 16, 35 days**. These are hypotheses for the pilot.
- Meeting a word (its introduction) puts it at stage 1, due the next day.
- In a **review session**, a word is asked twice — recall the meaning (options hidden until the
  learner asks for them) and type the word. It counts as **recalled** only if both are right:
  stage + 1 (capped at 5). Otherwise it returns to stage 1, due the next day, and `lapses` grows.
- New-word and practice sessions never move a word's schedule: same-day answers are weak evidence.
- Reviews take the most overdue words first, at most 8 per session; new words are never blocked.
- Intervals are added in UTC as exact 24-hour days. Time zones only decide which local calendar
  day a moment falls on (daylight-saving changes cannot stretch or shrink an interval).
- "Currently well learned" = stage ≥ 4: three delayed recalls in a row, the latest after ≥ 7 days.

The logic lives in `backend/app/services/scheduling.py` (pure); `services/sessions.py` applies it
in the same transaction as the attempt that completes a word.

## Consequences
- The schedule can be explained to a learner and a teacher in one sentence per rule.
- No per-word difficulty: a word that is always hard keeps cycling through stage 1. If the pilot
  shows that is common, a later decision can add difficulty or SM-2-style ease factors.
- Changing intervals later only affects future reviews; each rescheduling attempt records
  `stage_after` and `due_after`, so the effect of any change can be analysed.
