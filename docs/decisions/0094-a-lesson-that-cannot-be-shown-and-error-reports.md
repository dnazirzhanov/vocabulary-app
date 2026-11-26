# 0094 — A lesson that can't be shown again; the app's errors reported

**Status:** Accepted (the owner, 26 November 2026: a learner on the web reported «a deck won't open, a lesson won't
start», every deck showing «Что-то пошло не так. Попробуйте ещё раз.»).

## What happened
- Lessons are planned and kept on the device (ADR 0062). A lesson left open is shown again on every deck page
  («Продолжить урок») and resumed when a lesson starts.
- If a word of it has since left the device, the next study pack no longer has it, and showing the lesson crashes.
  A word leaves when its teacher takes it out of the deck, or when the deck leaves the learner.
- So one stale lesson shut **every** deck page and **every** lesson start. That crash is a TypeError, which the
  screen can only call «Что-то пошло не так», so nothing reached the server and the server saw nothing wrong.
- Reproduced end to end (`e2e/broken-open-lesson.spec.ts`): a lesson left open, its words removed from the deck,
  then a reload. The live code shows the learner's exact screen.

## Decision
- **A lesson is resumed only if it can be shown.** `showable`: every word of it is still on this device.
  - One that isn't counts as not open: deck pages open, «Продолжить урок» isn't offered for it, and a new lesson
    starts.
  - When a new lesson starts, it is set aside, so the server still hears of any answers it had.
- **The deck page doesn't depend on it.** If checking for an open lesson fails anyway, the page opens as if there
  were none. If the device can't work out the deck's numbers, they come from the server (as before); that failure
  is now reported.
- **The app's own errors are reported** (`POST /client-errors`, table `client_errors` with row-level security on):
  - **When:** whenever the app can only say «Что-то пошло не так», and any error nothing caught. Browser noise
    («ResizeObserver loop», another site's «Script error.») is left out.
  - **What:** where, the error's name, message and stack, the build, and the browser. Never the learner's words
    or answers.
  - **Limits:** each different error once per visit, and 20 an hour per learner. Long texts are cut.
  - **Why a table:** Fly keeps only the last 100 log lines, so a log line alone would be lost. The table is read
    the same read-only way as other production data.
