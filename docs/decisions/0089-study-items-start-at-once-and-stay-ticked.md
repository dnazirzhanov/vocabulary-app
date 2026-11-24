# 0089 — A study item starts the lesson at once, and stays on the list ticked when finished

**Status:** Accepted (the owner, 25 November 2026: «if you finish one of the tasks like learning new words from the
deck, the app does not show it in the list as completed … if you press … study the deck from the to do list, it is …
taking you to the main page of the deck. no, we want to take them directly to there»). Amends 0087.

## Decision
- **A tap starts it:** «Учить «…»» opens that deck's flashcards at once, «Правописание: «…»» its spelling. When the
  lesson ends («На главную», or leaving it), the learner is back in «Планы». Only when a lesson can't start (nothing
  left, a server refusal) does the tap open the deck's page instead.
- **Finished stays in view:** this device keeps today's study list as it was seen. A deck that was waiting earlier
  today and has nothing left now stays on the list, ticked (a check in place of its icon), crossed out, «Выполнено».
  The first time it is seen finished, its tick is celebrated like a task's (ADR 0088). If words come back to it later
  the same day, it is waiting again. Yesterday's list is dropped.

## Limits
- It is this device's memory: a deck finished on another phone, before «Планы» was opened today, shows nothing until
  it is studied here.
