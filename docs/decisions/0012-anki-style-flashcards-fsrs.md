# 0012 — Anki-style flashcards scheduled by FSRS

**Status:** Accepted. Supersedes ADR 0006 (Leitner scheduler) and the quiz part of ADR 0003;
revises the point rules of ADR 0008.

## Context
The owner asked for the study format to work "just like Anki": show the English word, let the
learner try to recall it, reveal the answer (translation, example in context, audio), and let them
rate how well they knew it. The ratings should drive a per-learner memory model, so the words each
person tends to forget come back more often. The quiz exercises (choose the translation, type the
word) right after introducing a word are removed for the demo.

## Decision
- **Card flow, Anki order:** front (word, part of speech, audio) → «Показать ответ» → back
  (translation, picture if any, example with the word highlighted and audio, Russian translation)
  → rating «Снова / Трудно / Хорошо / Легко». Rating after the reveal is an honest self-check.
  Keyboard as in Anki: Space shows the answer, then Space means «Хорошо»; 1–4 rate.
- **Scheduler: FSRS** via the maintained [`fsrs`](https://pypi.org/project/fsrs) library (MIT,
  6.x), the model behind Anki's modern scheduler: per card *difficulty*, *stability* and the last
  review; the next review is due when recall probability falls to 90%. Learning steps 1 and 10
  minutes, relearning 10 minutes, as in Anki. Fuzzing is off so schedules are reproducible.
  Default parameters; per-learner optimisation is a pilot follow-up once enough reviews exist.
- **Interval hints** under each button («1 мин», «10 мин», «3 дн») come from FSRS for the card's
  current state.
- **Sessions** (`kind: study`): due cards from every deck first, most overdue first, then new words
  of the current deck up to today's pace (ADR 0010; the review-debt brake stays). A card due again
  within 20 minutes (a learning step) comes back later in the same session, at most four showings
  in all. `kind: hard`: practice on the learner's hardest words (highest FSRS difficulty, then
  lapses), which records ratings but never moves the schedule.
- **Self-graded, still idempotent:** the card carries its answer (nothing to hide), one rating is
  stored per showing (`UNIQUE(session_id, exercise_id)`), retries return the first rating.
- **Points (ADR 0008 revised):** 10 for a new word's first showing, 5 for a review card's first
  showing in a session, nothing for repeat showings or practice. Points never depend on the rating,
  so pressing «Легко» is never rewarded. The recall rate is the share of review cards (first showing
  in a session) not rated «Снова» over 30 days.
- **"Помню хорошо"** = in review with stability ≥ 21 days (word list, path, progress).

## Consequences
- Existing Leitner progress was converted approximately (stability = the old interval, difficulty
  5); quiz sessions still open were closed. Old quiz attempts stay in history.
- The schedule is only as good as the learner's honesty; points ignore ratings to avoid an
  incentive to overrate, and the planned placement check will use pseudo-words.
