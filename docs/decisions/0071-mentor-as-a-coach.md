# 0071 — The mentor as a coach: goal, small steps, a time, a commitment, adjusted weekly

**Status:** Accepted (the owner's direction, 19–20 November 2026). Builds on ADR 0039 (promise) and 0042 (reminders).

## Context
The owner: the app's goal is to help learners set an English goal, break it into small activities, find the best
time and the amount of time they can give — kept adaptive, so they find what works — and commit to it; the mentor
should be a real mentor that sets goals with them and says what to do now.

## Decision
A coaching loop with deterministic rules (`backend/app/services/coach/`); the chat model only talks about it and fills
it in from what the learner says.

- **Goal** (`mentor_goals`, one active, history kept): a kind, a target (CEFR level or IELTS band), an optional
  deadline, «why», and a start level (the course level unless given). An honest check: Cambridge's approximate
  guided learning hours between the levels, against the promised minutes, gives **on track / tight / not possible /
  open**, with the minutes a day the deadline would need and the date the current pace reaches the target.
- **Breakdown:** each goal kind splits the week between words, reading, writing and speaking; minutes become things
  to do (a word ≈ 1.2 min with its reviews, a text 7, an essay 15, a spoken answer 5). Progress is counted from what
  the learner really did (new words, texts answered, essays checked, spoken answers).
- **When:** 2–3 study times, free on every chosen day (10 minutes of air around schedule blocks), scored for being
  near when the learner already studies (last 4 weeks), in their preferred part of the day, and right after a block.
- **Commit:** the promise (ADR 0039) gains a study time (`promise_changes.start_minute`, `minutes`), versioned like
  the days, from tomorrow. Changing only the days keeps the time. The day's second reminder comes at the study time
  instead of 17:00; a morning study time replaces the morning note.
- **Now:** the next task when free, the block and its end when busy, «done» when the list is.
- **Adapt:** on the first look each week, last week against the promise gives at most **one** proposal, with its
  evidence: easier (−5 min, then a day fewer) when fewer than half the promised days were kept; move the time when
  the usual start is an hour or more away; +5 min when every day was kept with 20 % to spare; or «behind» for a goal
  out of reach. The learner accepts or dismisses; accepting changes the promise from tomorrow. One a week
  (`mentor_adjustments`).

## Consequences
- The numbers are estimates and are shown as such; the weekly adjustment corrects course.
- Reminders still need the hourly scheduler (docs/deploy.md); a study time is reminded within the hour after it.
- The chat's tools (next PR) call these same rules, so the chat and the screens never disagree.
