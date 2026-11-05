# 0048 — A group's test: skipping, a new attempt each opening, and misses in «Трудные»

**Status:** Accepted (the owner's decisions, 5 November 2026). Amends ADR 0046 and 0026.

## Context
Thinking through how a class really uses the test (ADR 0046), the owner asked that students can skip a word they don't know and
move on to ones they do; that the teacher can open the test again and everyone can retake it, even those who passed; and that what
went wrong becomes individual practice.

## Decision
**Skipping.** «Пропустить» sits on the question's own line, above its card, in the test and in the group's «Тренировка»: it is about the question, and beside «Дальше» it
looked out of place and invited a slip. A skipped word comes back once, after the others, half-built
as it was, marked «Пропущенное слово». Skipping it then is final. A word still skipped at the end is wrong; the total doesn't change. Which skip it is goes with
the request, so repeating one changes nothing.

**One attempt per opening.** Each time a closed test is opened, everyone gets one attempt. The database holds it to one per opening, and never two of a kind
unfinished, so nobody has two clocks. A running attempt resumes first, even from an earlier opening. Opening an open test gives nothing new. This replaces ADR 0046's
one attempt ever.

**The group sees each student's latest result.** A retake can turn «Сдали» into «Не сдали», or the reverse. Someone mid-retake, or who doesn't retake, keeps their last score.
Earlier attempts stay as data. A page left open notices within 30 seconds, so a class needn't reload.

**The result is built from a lesson's finish screen (ADR 0024),** so it reads as the same product: the score in a ring on the stage, with the pass mark shown if it fell short, a title and a line beneath, then word rows, with the way on at the bottom.
A pass gets the same celebration as a lesson; falling short stays calm, in grey and never red. The owner rejected a first, plainer page as ugly and foreign to the app.

**The feedback tells three things apart:** «Ошибки», with what was written; «Пропущено»; and «Не успели», words the time ran out on. Skipped words join «Слова для работы» too.

**Misspelled and skipped words go to «Трудные».** Each counts as a miss on the spelling ladder (ADR 0026) as the timed attempt finishes, however it finishes. Words the time ran out on
don't count: not reaching a word says nothing about it. A word right in a test moves nothing, so only practice moves a word up. Practice attempts don't feed it. ADR 0046 kept tests apart from
the ladder; a test still keeps no promise and moves no memory schedule.

**The ladder no longer asks that a word was met in a lesson.** A test can put a word there first, and it would otherwise silently never appear. New words and «Вразброс» still draw only from words met.
«Трудные» holds hard words from every deck, as before, though it is reached from a deck's page; the way to it shows once anything is hard.

**Words and decks stay deletable.** A word on someone's ladder leaves its deck but stays with them, as a word someone met does. Deleting a deck removes its words from ladders. That fixed a bug
already there: a deck someone had spelled from could not be deleted at all.

## Consequences
- **Closing and reopening by mistake gives everyone who finished a new attempt,** and closing is also how the owner reaches the settings. There is no warning, to keep the page quiet. Worth adding if it bites.
- «Трудные» can grow quickly for someone who skips a lot of words they haven't studied. That is accurate, and a lot at once.
- Attempts multiply with retakes, and results stay for as long as the test: see `docs/research/capacity-2026-11.md`.
- A page with a test now refreshes every 30 seconds even while closed, so a class of 30 sitting on it adds about one request a second.

## Not in this
A warning on reopening, a class-wide view of hard words, deadlines on openings, hints in the group's test.
