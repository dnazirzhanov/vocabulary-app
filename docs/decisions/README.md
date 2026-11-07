# Architecture decision records

One file per decision that is costly to reverse or easy to second-guess. Format: context, decision, consequences. Supersede a record with a new one instead of editing history.

| # | Decision | Status |
|---|---|---|
| [0001](0001-repository-layout.md) | Keep `web/`; add `backend/` and `content/` beside it | Accepted |
| [0002](0002-backend-stack.md) | FastAPI, SQLAlchemy 2, Alembic, psycopg 3, uv | Accepted |
| [0003](0003-server-side-answer-evaluation.md) | The server evaluates answers; one attempt per exercise | Accepted |
| [0004](0004-auth-seam.md) | Auth seam with a development user until a provider is chosen | Accepted |
| [0005](0005-content-as-yaml.md) | Vocabulary as version-controlled YAML with a validated import | Accepted |
| [0006](0006-leitner-scheduler.md) | Leitner-style review scheduler (1/3/7/16/35 days) | Superseded by 0012 |
| [0007](0007-dev-clock-and-server-time.md) | Development clock override; day labels from server time | Accepted |
| [0008](0008-points-goal-streak.md) | Points, daily goal and streaks reward evidence of learning | Goal and streak superseded by 0015 |
| [0009](0009-supabase-auth.md) | Supabase Auth with local JWT verification; one container for API and web | Accepted (confirmation, reset and deletion replaced by 0043) |
| [0010](0010-pace-and-course-goal.md) | A sourced course goal; a daily pace the learner picks and the app tunes | Accepted (pace per deck: 0028) |
| [0011](0011-friend-groups-and-board.md) | Friend groups with a weekly board that rewards showing up | Accepted |
| [0012](0012-anki-style-flashcards-fsrs.md) | Anki-style flashcards scheduled by FSRS | Accepted; refined by 0025 |
| [0013](0013-recorded-audio-and-tap-a-word.md) | Recorded neural-voice audio; every example word tappable | Accepted |
| [0014](0014-course-levels-and-anki-deck-list.md) | Level decks, later ones locked; Anki-style counts and a «Today» home | Accepted |
| [0015](0015-plan-days.md) | Plan days: consistency against the learner's own promise | Accepted |
| [0016](0016-spelling-with-letter-tiles.md) | Spelling with letter tiles: one card per new word, part of the day's plan | Accepted; refined by 0026 |
| [0017](0017-teacher-decks-and-assignments.md) | Teachers' decks given to a group, met first within the learner's own pace | Accepted |
| [0018](0018-drafting-decks-from-text.md) | Drafting a deck from a teacher's text with DeepSeek; checked in code, reviewed by the teacher | Accepted |
| [0019](0019-personal-decks.md) | Personal decks anyone writes, «Мои колоды», full cards from a word with AI | Accepted |
| [0020](0020-deck-pages.md) | Deck pages: home is the course's levels; every lesson belongs to one deck | Accepted |
| [0021](0021-own-decks-first.md) | Home is «Мои колоды»; the course is offered below, one tap away | Accepted |
| [0022](0022-progress-by-deck.md) | «Прогресс» by deck: words learned (recalled in a later review); a day kept with every review done | Accepted (day rule superseded by 0027) |
| [0023](0023-friends-groups-first.md) | «Друзья»: groups first; a group's statistics over a week, month or all time | Accepted (ranking refined by 0027) |
| [0024](0024-celebrations-and-reward-sounds.md) | Finish screens celebrate with confetti and a chord; a chime for each word spelled right; sounds can be turned off | Accepted |
| [0025](0025-anki-days-and-ordered-intervals.md) | Scheduling days start at 4 AM; reviews due from the start of their day; Hard < Good < Easy, a day apart | Accepted |
| [0026](0026-spelling-ladder-and-modes.md) | Spelling: a ladder per word (hard → 3 → 7 days → «умеет писать»), ten words at a time, modes today / hard / random | Accepted; sets drawn from one deck by 0056 |
| [0027](0027-no-plan-rank-by-words-learned.md) | No «план»: a day counts with any finished session; friends rank by words learned (ties: days, weeks in a row) | Accepted |
| [0028](0028-pace-per-deck-and-deadlines.md) | New words a day per deck, changed in place; extra words for today; a teacher's «Выучить к» spread evenly, done a day early | Accepted |
| [0029](0029-decks-from-photos.md) | Decks from photos read in the browser (Tesseract): 4 per draft, 8 per deck; 1–50 words a draft | Accepted |
| [0030](0030-who-keeps-up-with-a-deadline.md) | Who keeps up with a deadline: «успевает» / «отстаёт на N» / «ещё не начинал»; the teacher sees all, a student only their own | Replaced by 0054 (nobody is shown it) |
| [0031](0031-deadline-reminders-by-web-push.md) | Deadline reminders by Web Push: opt-in per device, one evening reminder only when a deadline deck has words today | Accepted (schedule replaced by 0042) |
| [0032](0032-quiet-friends.md) | «Друзья» without the noise: my week, «К уроку», a weekly league of one number a person; the rest one tap away | Accepted (the league replaced by 0039) |
| [0033](0033-quiet-progress.md) | «Прогресс»: words learned, then each deck in two lines — how far along, and its goal (today, and the finish at its pace or deadline) | Accepted |
| [0034](0034-progress-at-a-glance.md) | «Прогресс» at a glance: «Вы знаете N слов, +M за неделю», the week, deck cards in plain stages (знаю · учу · впереди) with a goal; settings behind ⚙ | Accepted |
| [0035](0035-deck-page-plain-today.md) | A deck's page: today in one sentence, «В день: N новых слов · Изменить», no «finish the other lesson first» (it is set aside), rename in place | Accepted |
| [0036](0036-give-to-a-group-in-a-window.md) | Giving a deck to a group in a window: a button on the editor's «Новые карточки» card and a quiet icon on a deck's page | Accepted (the window's contents replaced by 0049) |
| [0037](0037-quiet-opening-page.md) | A quieter opening page: no intro sentence, no «Созданные мной» heading, no «Сегодня: …» on deck cards | Accepted |
| [0038](0038-no-today-line-on-the-deck-page.md) | A quieter deck page: no «today» sentence (the button carries it), no «Ваша колода» | Accepted |
| [0039](0039-promise-and-report.md) | «Друзья» as a promise and a report: chosen weekdays, who kept it today by name, words learned from the deck, missed days this month, pauses; the league goes | Accepted |
| [0040](0040-group-rights.md) | Group rights in one table the API reports (`can`): rename in place, leave from a visible link (an owner names a successor), hand over, new invite link, delete | Accepted |
| [0042](0042-notifications-by-each-learners-clock.md) | Notifications at 08:00 and 17:00 by each learner's clock, with the group's report and deck deadlines; four choices; a first-run question; ⚙ on every page | Accepted |
| [0043](0043-accounts.md) | Accounts for a class: codes by email through a free Gmail sender, reset, per-device sign-out, deleting the login too with the password asked again | Accepted |
| [0044](0044-capacity-and-cleanup.md) | Old answers give way nightly with what screens need kept apart; a full server refuses at once and the app retries; friends screens read only the days they show | Accepted |
| [0045](0045-first-run-two-questions.md) | Login first; a new password typed twice; «Выйти» on the main screen; first run as two small questions with no pitch or pictures | Accepted |
| [0046](0046-group-spelling-tests.md) | A group's spelling tests: the owner sets words, time and pass mark and opens it; a timed attempt (amended by 0048) with results open to the group; private unlimited practice; each attempt's order saved; the server's clock; a test's misses go to «Трудные» (0048) | Accepted |
| [0047](0047-audio-hint-in-spelling-practice.md) | An audio hint in individual spelling practice: «Подсказки: Буква · Звук» below the letters; the word is said on a tap, as often as asked; a word heard counts as a miss on the ladder, like one hinted; a group's test has no hints at all | Accepted |
| [0048](0048-group-test-skips-retakes-hard-words.md) | A group's test: skipped words come back once; each opening gives everyone one attempt; the group sees the latest result; misspelled and skipped words go to «Трудные» | Accepted |
| [0049](0049-give-to-a-group-as-a-list.md) | Giving a deck to a group: one list of my groups, each with one action, and the deadline as a line of text that opens the picker | Accepted |
| [0050](0050-another-spelling-mode-while-one-waits.md) | A spelling left unfinished no longer hides the other modes: «Продолжить» resumes it, and choosing another set replaces it, keeping what was spelled | Accepted |
| [0051](0051-one-words-button-no-deadline-sentence.md) | A quieter deck page: one button for a deck's words, its editor reached from there; no sentence about a deadline, and with it no «Напомнить в 17:00» | Accepted |
| [0052](0052-friends-words-as-on-progress.md) | A friend's words on the group's page as on «Прогресс»: words met of the total, the two-tone bar and «знаю · учу · впереди», each friend a card; one component for both | Accepted |
| [0053](0053-test-results-as-one-card-a-group.md) | A test's results as one card a group: a row a person with a small score bar, names of those yet to take it in a run, a neutral ring for «Не сдали»; never ranked | Accepted |
| [0054](0054-no-readiness-for-class.md) | Nobody is told who keeps up with a deadline: «К уроку», «отстаёте на N» and «Готовы N из M» go, and the server stops sending them; a learner's own line in the deadline day's notification stays | Accepted |
| [0055](0055-languages.md) | Learn English in your own language: separate translation and app languages, the translation language chosen where cards are made, the course stays Russian-only, every line typed against the Russian one | Accepted |
| [0056](0056-spelling-per-deck.md) | Each deck's spelling is its own words: a session names its deck, counts and an unfinished spelling are the deck's, one ladder per word | Accepted |
