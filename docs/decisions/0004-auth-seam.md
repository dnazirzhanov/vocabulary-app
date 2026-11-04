# 0004 — Auth seam with a development user until a provider is chosen

**Status:** Accepted

## Context
The brief schedules authentication for Phase 4 but requires server-side authorization for every user-owned resource, and warns against mistaking a prototype for a multi-user product. The provider (pricing, availability from Kyrgyzstan, data export) is not chosen yet.

## Decision
- Every endpoint resolves the user through one dependency, `get_current_user`. No handler accepts a user id from the request as proof of identity; all queries filter by the resolved user.
- `AUTH_MODE=dev` is the only mode for now. It resolves to a local development user; an `X-Dev-User` header selects a different local user so ownership can be tested with two identities.
- Settings validation refuses to start with `ENVIRONMENT=production` while only `dev` auth exists.
- Phase 4 adds `AUTH_MODE=jwt`, verifying provider tokens and mapping the subject to `users.auth_subject`.

## Consequences
- Authorization is real and tested from the first slice (another user's session returns 404).
- The `X-Dev-User` header is a development convenience only; it must never be honoured outside `dev` mode, which the settings check enforces.
- Switching to a provider changes one module, not every endpoint.
