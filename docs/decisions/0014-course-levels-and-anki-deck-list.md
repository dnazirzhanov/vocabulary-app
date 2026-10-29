# 0014 — The course as level decks, counted like Anki's deck list

**Status:** Accepted. Extends ADR 0010 (pace and course goal) and ADR 0012 (flashcards).

## Context

The course grew from one 30-word starter deck to three level decks of 100 words each:
A1–A2 «Основа», B1–B2 «Уверенный уровень» and C1 «Продвинутый уровень» (CEFR-J and Octanove
word lists, ordered by NGSL frequency). The owner asked for decks "like in Anki": for every deck,
how many words are new and how many must be repeated, so the learner always knows what today holds.
Anki's strength is a clear loop — see what is due, study it, rate it — not its visual design.

## Decision

- **Levels in order, later ones locked.** Decks have a `level` ("A1–A2") and a `level_order`. The
  current level is the first one with words not yet met; later levels are locked until it is done.
  A locked deck cannot be studied (`409 deck_locked`); its row says which level opens it.
- **Anki's three numbers, per deck and in all.** `/api/decks` returns for each deck:
  `new_today` (new words today's pace still allows; only the current level has any),
  `learning_count` (due cards in FSRS learning or relearning steps) and `review_count` (due
  long-term reviews). "Due" means due now: the cards a session started now draws from (up to
  30 reviews per session; another can follow straight away).
  Labels: «Новые», «Изучаемые», «К повторению», shortened to «Нов. / Изуч. / Повт.» in the deck
  table, in Anki's blue / red / green; every number also carries its name, never colour alone.
- **Home is "Today", not a deck manager.** Home shows today's three numbers across the course and
  the deck list with its counts, nothing else. One button studies everything: due
  cards of every level, most overdue first, then the current level's new words («Продолжить»,
  a study session with no `deck_id`). Earlier levels keep coming back through their reviews.
- **Tapping a deck studies it,** with no page in between: a session of that deck's due cards, then
  its new words if it is the current level. A locked level cannot be pressed. (An earlier version
  had a deck overview with the word list and the stepping-stone path; the owner dropped it. Those
  components remain in the code but nothing links to them.)
- **Sections live in the navigation:** «Сегодня · Друзья · Прогресс» as a sidebar on desktop and a
  bottom tab bar on phones. Entries are names only: no line of news under them (a place in the
  group, «вы на 4-м месте из 7», was tried and dropped). Lessons and their summary are full-screen,
  without the navigation. On a group's board, «Пригласить друзей» sits under the group's name and
  opens the QR code, code and link in a modal window; a newly created group opens it at once.
- **No plan section.** The owner removed it: the «План» tab, the calendar of words known per day and
  the finish-date roadmap, and the third onboarding step that previewed them. First run is now the
  promise and the pace. The pace (words per day, days per week) can no longer be changed after
  onboarding except through the home screen's pace suggestion; no screen shows a finish date.
- **Progress answers two questions** (what is my progress, how consistent am I) with two figures
  and little text. _Words:_ met out of the course goal, with those remembered well drawn darker
  inside the bar, beside «помните хорошо», «ещё закрепляете» and the 30-day recall. _Consistency:_
  this week against the learner's own weekly commitment (`study_days_per_week`, chosen at onboarding)
  and a GitHub-style calendar of the last 18–26 weeks. A day counts when the daily goal is met,
  the same rule as the friends board; a lighter day was practised below it. The calendar never
  marks a miss, days still to come are open outlines, and the nudge «Ещё N дней до цели недели»
  appears only while the week can still be met. The streak stays on home (a small flame) but is
  not the measure of consistency. Progress is now course-wide: `GET /api/progress`.
- **The pace is course-wide.** The daily target, the review-debt brake and "words left" count every
  level; the onboarding promise and the progress page count words met across all decks toward the
  1,300-word goal.

## Consequences

- The old `starter` deck is set to draft (its words live on in A1–A2), so existing progress
  carries over; sessions that point at it still open.
- A session records the deck that supplied its new words; the web app remembers whether it was
  started for one deck or for the whole course, so «Дальше» and leaving a lesson keep to it.
- Not adopted from Anki (yet): recognition _and_ production cards per word with sibling burying,
  suspending a word, editing during review, a two-button mode, and learner-added words. They are
  candidates for later milestones.
