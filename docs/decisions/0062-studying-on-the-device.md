# 0062 — Studying on the device: lessons planned, scheduled and checked on the phone, answers re-applied by the server

**Status:** Accepted (the owner's decisions, 8 November 2026). Built in steps: the engine (this record's first PR), the server's events, the lessons on the device, a capacity recheck.

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

## Consequences
- Two schedulers to keep equal; the cases are the guard, and the server's result wins if they ever disagree.
- The per-card routes stay as the tested core of the rules (the backend tests use them); the web stops calling them.
- Found while writing the cases: a one-letter word («a», «i», allowed in one's own deck) made the server's tile bank fail, so spelling it would have crashed. Both sides now keep such a bank as it is.
