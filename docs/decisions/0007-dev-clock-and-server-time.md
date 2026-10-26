# 0007 — Development clock override and server time

**Status:** Accepted

## Context
Spaced repetition only shows its behaviour after days pass. Testing "come back tomorrow" by
waiting is impossible in CI and slow by hand. Separately, phone clocks are often wrong, which
would make labels such as "next review tomorrow" lie.

## Decision
- The current time reaches services through one dependency (`app/core/clock.py`). Services never
  read the clock themselves; they receive `now`.
- In `AUTH_MODE=dev` only, an `X-Dev-Now` header sets that time (ISO 8601 with an offset). Like
  `X-Dev-User` (ADR 0004), it cannot exist in production because dev auth cannot.
- Every response from an endpoint that uses the clock carries `X-Server-Time`. The web app keeps
  the offset to its own clock and counts calendar days from server time, in the device's time zone.
- Database sessions use `timezone=UTC`, so timestamps leave the API in one representation wherever
  PostgreSQL runs.

## Consequences
- Review flows are tested through the real API and in the browser (`e2e/review.spec.ts`).
- Day labels stay right on a phone whose clock is wrong.
- The header is a development affordance; it must be removed or ignored if a non-dev auth mode
  is ever allowed to honour development headers (the settings check prevents this today).
