# 0009 — Supabase Auth with locally verified tokens; one container

**Status:** Accepted (provider chosen by the product owner after the comparison in
`docs/research/hosting-and-auth-2026-10.md`). Confirmation, password reset, and what deleting an
account removes are replaced by ADR 0043.

## Decision
- Learners sign up and in with **email and password** through Supabase Auth in the browser. For the
  demo, email confirmation is switched off in Supabase (no sending domain yet) and password reset is
  handled by the organizer; both are revisited before a wider pilot.
- The API never sees passwords. It verifies the access token **locally** against the project's
  public keys (JWKS; ES256/RS256 only, `exp`, `iss`, `aud`, `sub` required, keys cached 10 minutes)
  and maps `sub` to `users.auth_subject` (`supabase|<id>`). Development headers
  (`X-Dev-User`, `X-Dev-Now`) are ignored outside dev mode, and production refuses to start in dev mode.
- Account deletion (`DELETE /api/me`) removes all learning data here. Removing the Supabase login
  itself needs the service key, which is deliberately not given to the API; the organizer deletes it
  from the Supabase dashboard on request.
- One container serves the API and the built web app (one origin, no CORS). The publishable key and
  project URL are baked into the web build; nothing secret is.

## Consequences
- Switching provider later means changing the issuer and JWKS URL, not the endpoints.
- Free-tier gaps (no backups, one-week pause, no outgoing email) are mitigated in `docs/deploy.md`.
- Without email confirmation anyone can register with any address; acceptable for a demo only.
