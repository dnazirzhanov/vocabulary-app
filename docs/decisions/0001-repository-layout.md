# 0001 — Keep `web/`; add `backend/` and `content/`

**Status:** Accepted

## Context

The brief suggests `frontend/`, `backend/` and `content/`, while asking us to adapt to the existing repository rather than replace working files. A working, tested React app already lives in `web/` with its own README, scripts and CI-ready commands.

## Decision

Keep `web/` as the frontend directory. Add `backend/` and `content/` at the repository root. Inside `web/`, organise by screen (`home/`, `lesson/`, `summary/`) plus shared `lib/`, `ui/`, `styles/`, rather than the brief's `features/` + `pages/` split, because each screen is currently one feature.

## Consequences

- No churn renaming paths, history stays readable.
- Directory names differ from the brief's sketch; this record is the explanation.
- If the app grows several features per screen, introduce `features/` then.
