# 0050 — Another spelling mode while one waits

**Status:** Accepted (the owner's request, 6 November 2026). Replaces the last sentence of ADR 0026's "Spelling left midway".

## Context
Leaving a spelling exercise returns to the deck's page. An unfinished one showed only «Правописание не закончено» with
«Продолжить», and «Другие режимы» disappeared. Asking the server for another set returned the unfinished session anyway
(ADR 0026: "whichever set is chosen"). So the only way to practise something else was to finish the words already chosen.
The owner found this while testing: a learner should be able to stop one exercise and start another mode.

## Decision
- **The deck's page shows both:** the unfinished spelling with «Продолжить», and «Правописание: другие режимы» under it.
- **Choosing a set replaces the unfinished one,** the same way a lesson in another deck is set aside (ADR 0035). There is
  still one open spelling at a time, so the page has one thing to resume.
- **What was spelled stays.** Each answer moved its word on the ladder when it was given, so nothing is undone. Words not
  reached aren't lost either: they are still in their sets.
- **The window says so, only when it applies:** «Незаконченное правописание закроется, написанное сохранится.» No second
  question, since nothing of value is lost.
- **The main button keeps resuming.** The server tells the two apart by the set asked for: `mix` resumes whatever is open,
  and a named set (`today`, `hard`, `random`) starts new.
- **A set with no words changes nothing:** the request is refused and the unfinished spelling stays.

## Consequences
- While a spelling waits, the main set (`mix`) can't be started on its own: it isn't one of the other modes, and its button
  is what «Продолжить» replaces. Finishing or replacing the unfinished one brings it back. Left this way to keep the window
  at three choices.
- A replaced spelling stays in the database unfinished, as a set-aside lesson does. A device still showing it can finish it.
