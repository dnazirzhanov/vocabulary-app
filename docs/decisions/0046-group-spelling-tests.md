# 0046 — A group's spelling tests: a timed class test, private practice, open results

**Status:** Accepted (the owner's decisions, 4 November 2026).

## Context
Students come back to class, the teacher asks them to take a spelling test of the deck, and each result
should land in the group for everyone to see. The owner ruled out a live session: no invitations, no waiting
room, no synchronised start. Attempts should also become data each student can use to work on their weak words.

## Decision
**One test per deck of a group.** A row «Тесты» on the group's page leads to the group's decks, then a deck's test.

**What the owner sets, in one window:** all the words or N at random, words to leave out, the time, and the pass
mark (80% by default). Everything is filled in, so it can be one tap. Saving doesn't open it: «Открыть тест» and
«Закрыть тест» are separate, and the settings wait while a test is open, since other words erase results. The right is `manage_tests` in the one table (ADR 0040), so the Administrator gets it
by a line when that role comes.

**N at random is drawn once,** so everyone is judged on the same words, because the results are public. Saving the
same settings keeps the draw. Other words make it a different test, so they erase its results, and the API
refuses unless told `reset: true`, after the window has asked.

**Two kinds of attempt:**

| | «Тест» | «Тренировка» |
|---|---|---|
| Time | The owner's limit | None |
| How many | One per student, enforced by a unique index | Unlimited |
| When | While open | Once a test is saved |
| Who sees the score | The group | The student |

«Начать тест» asks first («Время пойдёт сразу. Попытка одна.»), with «Отмена» focused: it is the one tap that can't be undone.
Both use the same letter tiles with no hints, and the screen says which kind it is. Nothing is said about a word until the end, then the score and each
mistake. Each timer starts on that student's own tap; closing stops new starts and spares anyone mid-test.

**Order.** Each attempt is shuffled once by the server with `random.SystemRandom().shuffle` (Fisher–Yates) and saved
row by row. The web never shuffles, so a re-render, reload or refetch can't change anything. An attempt holds its
own copy of each word, because `remove_word` can delete a word mid-test.

**A word's id is never sent to a student,** because a course word's id is its spelling (`house`). Each question has
a random key; answers are stored against the stable word id and graded by it, whatever the order. The first answer
stands, so a retry is harmless.

**The clock is the server's.** `deadline_at` is saved at the start. At zero the device locks the tiles, sends a word
that is fully built, and asks for the result. A part-built word and words never reached score as wrong. Nothing has to
stay connected: any read of the test finishes expired attempts from what was saved, so no scheduled job is needed.

An answer may arrive up to **20 seconds late.** The screen has already locked, so this only rescues one stuck in a slow
or retried request; it could otherwise cost a student a word on a busy server. Other people's looks at the results wait
out those 20 seconds, so they can't cut off an answer on its way.

**Results** use the report's style (ADR 0039): «Сдали», «Не сдали» with «9 из 10», «Ещё не проходили». Alphabetical with me
first, never ranked, nothing red. Whoever sets the test isn't listed as not having taken it, and nobody is listed as not having taken one that has never been
open. The group's page counts everyone still to take it («Сдали 2 из 4»), and shows members the way to tests only once one exists.
While a test is open the page
refreshes every 30 seconds, so a teacher sees results arrive.

**Weak words** are the words whose latest answered try, in either kind, was wrong, so getting one right takes it off.
They are the student's alone, and hidden while their timed test runs. «Потренировать» practises just those.

**Analytics stay in our database,** as `docs/product-requirements.md` requires: every word of every attempt, its order,
what was typed and when. Tests stay as long as the test does. Practice is unlimited, so `clean_up` removes it after the
same 35 days as lesson answers.

## Consequences
- **A test is separate from learning.** It keeps no promise and moves no schedule or spelling ladder. Feeding misses into
  the ladder is a natural next step, and left out for now.
- **Public «Не сдали» can sting, and learners may be minors.** It is the owner's explicit choice, softened with nicknames,
  no ranking and no red. Worth watching in a real class.
- **It isn't cheat-proof.** A student can open the deck in another tab; only the teacher in the room prevents that.
  Locking phones would be the complexity the owner ruled out.
- **A slow server takes from a student's time,** because the timer doesn't stop while an answer is saved. Measured for a class of 30: about 20
  seconds over 30 words at 0.1 CPU, about 70 at 0.05 (`docs/research/capacity-2026-11.md`). Starting and answering wait 30 seconds rather than the
  usual 15, because an error mid-test is worse than a wait, and both are safe to repeat.
- A student who leaves a group loses their results with their membership, as with the rest of the report.
- A test can't be taken twice, even by someone who was absent and made a mistake starting it. Only a change of words starts
  a new round, and that restarts it for everyone.

## Not in this
The Administrator role (parked), a push when a test opens or results arrive, a class-wide view of the hardest words, several
tests per deck.
