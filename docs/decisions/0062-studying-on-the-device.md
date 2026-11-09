# 0062 — Studying on the device: lessons planned, scheduled and checked on the phone, answers re-applied by the server

**Status:** Accepted (the owner's decisions, 8 November 2026). Built in steps: the engine (#78), the server's side (below), the lessons on the device, a capacity recheck.

## Context
Every card was a request: the server planned the lesson, scheduled each card with FSRS, checked each spelling, and stamped everything with its own clock. Without a connection nothing could be studied, each card waited on the network, and those requests were most of the server's load (about 0.3 a second per student in a lesson, against a ceiling of about 5 on the free instance; `docs/research/capacity-2026-11.md`).

## Decision
- **Device-first, always** (owner): one way of studying, online or not. The phone plans the lesson, schedules each card, checks each spelling, and keeps going with no network between cards. Answers go to the server in batches through the outbox (ADR 0061).
- **The server stays the authority.** It re-applies every answer, an immutable event with its true time, using the same Python code, and its result wins at the next pull. The device's engine is a prediction kept honest by shared test cases.
- **One set of rules, two languages, held together by cases:**
  - `web/src/study/` ports `fsrs` 6.3.2's `review_card`, the app's day rules (`scheduling.py`: study days from 4 AM, a better answer waits at least a day longer, review due at 4 AM), the lesson queue (`learning.py`), the day's pace (`pace.py`), and spelling and its ladder (`spelling.py`, `spelling_ladder.py`).
  - `backend/tests/study_vectors.py` writes `web/src/study/vectors.json` by running the Python code. It covers histories across ten zones (some with clock changes at awkward hours), day boundaries, and intervals landing on half days, where Python's rounding to the even day differs from JavaScript's.
  - A pytest check fails when the file and the code drift apart, and the web tests fail where the device differs.
  - Planting a JavaScript `Math.round`, a midnight day or a one-digit weight typo makes them fail.
  - Floats are compared to 1e-9; states, steps and due moments exactly.
- **Late answers count for the day they were given** (owner), with a guard. The device's clock is corrected by the server's. No answer may be dated before that device's last contact with the server, so days the server has already seen can't be filled in afterwards. Nothing later than a few minutes ahead, nothing older than 30 days.
- **Audio kept ahead** (owner): recordings for words due in the next 7 days and the next new words of decks in use.
- **Unchanged and online only:** group tests (server clock, ADR 0046), AI drafting, giving decks to groups.

## The server's side (step 2)
- **Two sync operations** (`schemas/sync.py`, applied in `services/study_sync.py`), in the outbox with the deck changes and applied in the order sent, each once (ADR 0061):
  - `study.answer`: one answer, with its device, its lesson (an id the device made), the deck, the exercise (`c1`, `s1`…), the word, the rating or the built word (and whether it was heard or hinted), and `answered_at` on the server's clock.
  - `study.finish`: the lesson finished, or set aside for another.
- **A device's lesson is made from its answers.**
  - The first answer creates it: `learning_sessions.origin = 'device'`, `started_at` = that answer's moment, and for a lesson the day's plan as it stood then.
  - Each answer adds its exercise to the plan, so the plan is what was answered, in order.
  - `study.finish` sets `completed_at` (never before the lesson's own last answer) or `set_aside_at`.
  - "One open lesson per learner" now holds for the server's lessons only. The per-card routes and «continue» never see a device's lesson.
- **The same functions, at the answer's moment.** `sessions.rate_card` and `sessions.spell_word` are the per-card routes' own code, called with `answered_at` as now. Points, introductions, first recall, the spelling ladder, studied days, promises and answering speed all follow from it. A card shown again was already shown again on the device, so the server doesn't insert it.
  - A test plays four days of lessons and spelling online, sends the same answers from another learner's device a week later, and finds every schedule, answer, point, rung and finished day identical.
- **Out of order for one word** (two devices offline): an answer earlier than one already applied is scheduled, and moves the ladder, as of that later answer. It still counts for its own moment. Only the first answer heard introduces the word. Rare, and never sends a schedule back in time.
- **The guard** (a refusal comes back as `rejected` with a code):
  - `in_future`: more than 5 minutes ahead of the server.
  - `too_old`: older than 30 days. Lessons are cleaned up at 35 (ADR 0044), so no late answer can reach a day already summed up.
  - `unknown_device`: a device studies from a pack, and fetching one registers it (`sync_devices`).
  - `before_last_contact`: more than 5 minutes before the device's last pack. The slack covers another tab answering while the pack was on its way.
- **Which words:** a lesson starts in a deck I may study. Every answered word must be in that deck, and hard words and spelling must be of words met. Later answers stand if the deck stops being mine meanwhile (I left the group), as an open lesson's do online. The course's level lock is not checked here: the device follows it, and it guides the learner rather than guarding anything.
- **The pack** (`GET /api/study/pack?device_id=…`), tagged with its content (`304` when unchanged). Fetching it is the device's contact, and it remembers the device's zone, the one its answers will be counted in. It holds:
  - every deck I study (the course's levels in order, my own, my groups') with its words in order;
  - those words;
  - my progress on every word I have met (so the review brake counts all of it);
  - my spelling ladder;
  - each deck's pace inputs: daily new words, deadline, today's extra words;
  - the new words met today and yesterday per pace.

  The glossary keeps its own tagged route. Measured on the dev data: a learner with 8 decks, 373 words and 105 met gets 125 KB, 30 KB gzipped.

## The device's side (step 3)
- **The screens are unchanged:** lessons, spelling, hints, the finish screen and the deck page take the same shapes as before. `study/device.ts` makes them on the device, with the same calls, instead of asking the server. Where the browser keeps nothing (no IndexedDB), the server's routes are used as before.
- **What the device studies from:** the last pack, plus the answers given here since, replayed by the same rules (`study/state.ts`). An answer leaves this replay only once a pack that holds it has arrived, so it is never lost and never counted twice. Every lesson (IndexedDB v3: `lessons`) survives a reload.
- **One transaction per answer:** the lesson, the kept answer and its outbox operation. Study operations name no deck in the outbox's indexes, so deleting a deck never drops an unsent answer.
- **Answers wait 15 seconds for the next ones;** a finished lesson goes at once. Online, the finish screen waits up to 3 seconds for it, so the next screen's numbers from the server include it.
- **The pack is fetched only after this device's answers are all sent:** fetching it is the device's contact, and the server refuses answers dated before it. It is fetched:
  - after a lesson is finished;
  - for a deck's page when online (waiting at most 2 seconds);
  - after a change made online that it holds (a deck's pace, extra words);
  - for a deck it doesn't have yet;
  - otherwise when it is over 10 minutes old.
- **The clock:** the server's offset is kept across visits, so an answer given offline is dated by the server's clock as last measured.
- **Refused answers** are dropped and said once on home («Не засчитано ответов: N…», in all six languages).
- **Audio kept ahead:** after each sync, recordings (word and example) of course words due in the next 7 days and the next 20 new words of each level are fetched, if the service worker hasn't kept them yet.
- **Proved:**
  - A lesson answered offline with a forgotten card shown again, a reload midway and a card known at once: after reconnecting, the server's due date for every word equals the device's own. A wrong time zone planted in the device's rules fails this test.
  - A phone clock set back three days gives the refusal and the line on home.
  - Recordings ahead play without a connection.
  - The course list and a level's page open offline.

## Consequences
- Two schedulers to keep equal; the cases are the guard, and the server's result wins if they ever disagree.
- The per-card routes stay as the tested core of the rules (the backend tests use them); the web stops calling them.
- Found while writing the cases: a one-letter word («a», «i», allowed in one's own deck) made the server's tile bank fail, so spelling it would have crashed. Both sides now keep such a bank as it is.
