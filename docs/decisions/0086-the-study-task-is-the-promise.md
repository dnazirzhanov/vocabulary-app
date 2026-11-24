# 0086 — The study task: ticked by practice, and it is the promise

**Status:** Accepted (the owner, 24 November 2026: a study task is done «by ticking it, and practice ticks it too»;
«studying at 21.00 like a recurring task … without having to set it up again»). Builds on 0084 and 0085.

## Decision
- **A task can be a study task** («Занятие в приложении»), from the book button in quick add or a switch in its
  details. The empty day's example, «Английский каждый день в 21:00», adds one.
- **Practice ticks it:**
  - On a day the learner finishes a session in the app, a study task with no mark of theirs counts as done, shown
    «по занятию».
  - It is counted when read, never stored, so a tick and practice can't disagree.
  - A mark of their own wins: a skipped day stays skipped. A day done by practice has no tick to take back.
- **The group's report counts it too:** a member who practised on that day has their group study task done.
- **It is the promise:**
  - A learner's own repeating study task writes their promise (`promise_changes`): its days, and its time with the
    minutes already promised (20 if none).
  - As any change of the promise, it applies from tomorrow, or at once for someone who hasn't finished anything
    yet.
  - So «Сегодня по обещанию», the streaks and the morning reminder follow «Планы», with no second idea of a promise.
  - A plain task, or a group's task, never touches anyone's promise.

## Consequences
- Deleting the study task leaves the promise as it was; the promise screen still changes it.
- Two repeating study tasks: the last one saved is the promise.
