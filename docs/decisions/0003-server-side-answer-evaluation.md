# 0003 — The server evaluates answers; one attempt per exercise

**Status:** Accepted

## Context

The prototype evaluated answers in the browser. Progress, scheduling and points must be trustworthy across devices, and the brief requires that repeated submissions never award duplicate points or corrupt review state.

## Decision

- Session plans, including answer keys, are generated and stored on the server. Clients receive exercises without answer keys.
- The client submits a response; the server evaluates it, records the attempt and updates progress in a single transaction.
- `UNIQUE(session_id, exercise_id)` allows exactly one attempt per exercise. A repeated submission (double tap, retry after a timeout, a second device) returns the stored result instead of re-evaluating.

## Consequences

- Feedback waits for a round trip (typically 100–300 ms). The UI shows a checking state on the primary button and distinguishes a network failure (retry) from a wrong answer.
- A learner cannot change an answer after submitting — intended, and consistent with the UI locking options after Check.
- Retries are safe by construction; no separate idempotency keys are needed.
