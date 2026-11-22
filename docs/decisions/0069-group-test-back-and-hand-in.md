# 0069 — A group's test: back and forth, a check, then «Сдать»; every attempt kept

**Status:** Accepted (the owner's decisions, 19 November 2026). Amends ADR 0046 and 0048.

## Context
Taking a group's spelling test, the owner wanted a way back to the previous word, with back, next, skip and
handing in working together sensibly; and every attempt's result kept, to look back on. Until now each answer was
final once sent, a skipped word came back once after the others (ADR 0048), and the attempt ended by itself after
the last word.

## Decision
**Back and forth.** The words keep the order the server gave them. «Назад» shows the previous word, «Дальше» saves
this one and shows the next. A saved answer stays changeable until the attempt is handed in; going back to a word shows
it built on the tiles. The card says where it stands: «Тест · слово 4 из 10».

**«Пропустить» leaves the word empty.** It no longer comes back on its own; the check shows it. A word answered and
then skipped is empty again.

**A check before handing in.** After the last word («К проверке») every word is listed by its meaning as «Есть ответ»,
«Пропущено» or «Пусто», each a way back to it. «Сдать» hands in at once if every word has an answer, and asks first
if some are empty («Они засчитаются как ошибки»). Nothing finishes before that, except the clock: at zero a word fully
built is saved and the server hands in what it has.

**«К пропущенным · N»** (the owner, 22 November 2026: «at the end, there has to be a return to the skipped
ones»). On the check, when some words have no answer, one button goes through just those, in order: the card says
«Тест · пропущенное 1 из 2», «Дальше» and «Пропустить» go to the next of them, «Назад» to the one before, and after
the last of them the check comes back. A word opened from the check's list still goes on in the usual order.

**Scoring is unchanged.** A word left empty when handing in counts as skipped; when the time ran out, a word never
reached counts as «Не успели». Misspelled and skipped words still go to «Трудные» (ADR 0048).

**Every attempt kept.** The test's page lists «Мои попытки»: every attempt I finished, tests and practices, newest
first, with its score; each opens its result. My own only; the group still sees each student's latest result.

**Practice works the same way.**

## How
`PUT /test-attempts/{id}/questions/{key}?at=N` saves (or, with null, empties) an answer and shows the word at N;
`GET /test-attempts/{id}?at=N` shows a word; `POST /test-attempts/{id}/submit` hands in. A running attempt reports
its `position`, the shown word's saved `answer`, and each word's state (meaning only, never the word). No migration.
The old `answers` and `skips` endpoints stay, with their old behaviour, for app versions already installed.

## Consequences
- An installed app that hasn't updated keeps the old one-way flow until it does; both work on the same attempts.
- After a reload the test opens on the first word not yet done, not necessarily the one last shown.
- A word half-built and then left by «Назад» keeps its letters on that device only; the saved answer is what counts.
