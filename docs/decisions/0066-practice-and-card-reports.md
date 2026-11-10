# 0066 — Practice whenever you like, and reports on wrong cards

**Status:** Accepted (the owner's decisions after the phone test, 10 November 2026).

## Context
The owner asked for two things after the phone test:
1. **Studying a finished deck again.** After learning a deck's words for the day, there was no way to go over them again before the spaced repetition brought them back.
2. **Saying a card is wrong.** A learner had no way to report a wrong translation, from a lesson or from «Все слова колоды». The owner also asked to choose how fast the example is read.

## Decision
- **«Повторить сейчас».** It goes over words already met in the deck: 10, 20 or all of them, the ones coming back soonest first.
  - It is a `hard` session, so the server keeps every word's schedule as it was, which is the owner's choice. It is planned on the device and works offline.
  - It appears as a row on the deck page. When nothing is left for today, it is also the main button.
- **The card's «⋯» in a lesson:**
  - the example's speed: «Обычная» or «Медленная» (0.75×, kept on the device);
  - «Сообщить об ошибке»: «Неверный перевод», «Неверный пример» or «Другое», with an optional note. «Все слова колоды» offers the same report on each row.
- **Reports** are stored in `card_reports`.
  - **Sending:** through the sync op `card.report` (so it works offline), or `POST /api/card-reports`.
  - **Limits:** one open report per learner and card, and 30 a day at most.
- **Who reads them:**
  - a course card's reports: the content editors (`CONTENT_EDITORS`, sign-in ids), in ⚙ → «Ошибки в карточках»;
  - a deck's own card's reports: the deck's author, in the editor.
  - Reporters' names are never shown, since learners may be minors.
- **Closing them:** correcting the card closes its reports, and so does «Исправлено».

## Verification
- **Backend:** `test_card_reports.py`.
- **Unit:** `planPractice`.
- **e2e:**
  - `offline-practice.spec.ts`: the server's due dates are unchanged after practice;
  - `offline-card-reports.spec.ts`: offline report, word-list report, the author's list and «Исправлено».
- **Planted faults:**
  - practice sent as a normal lesson fails the practice e2e;
  - editing that doesn't close reports fails the backend test.
