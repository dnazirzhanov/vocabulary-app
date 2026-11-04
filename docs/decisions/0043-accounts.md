# 0043 — Accounts that work for a class: codes by email, real deletion, sessions per device

**Status:** Accepted (replaces parts of ADR 0009: confirmation off, reset by the organizer, the login
surviving deletion, and no service key on the API)

## Context
Sign-up, login and logout existed (ADR 0009), built for a demo. The owner's bar: no cost, but it must
really work for about 1,000 students, who may be minors. At that size a password reset through the
organizer can't work, and neither can a login that outlives "deleting" an account.

## Decision
- **The provider stays.** Supabase holds passwords and sessions; we don't write our own.
- **Email through a dedicated free Gmail account,** as Supabase's custom SMTP. Supabase's own sender
  only reaches the project's team. Free senders such as Brevo can't authenticate a gmail.com address,
  and a domain costs money. Gmail signs its own mail and allows 500 a day: about 16 classes of 30
  signing up in a day, then a few resets. A real domain later is a settings change, no code.
- **A code typed in the app, never a link,** for confirming an address and for a reset. A link would
  open in Safari, outside an iPhone's home-screen app (a separate session), lose a pending invite
  kept for the tab, and can be used up by a mail scanner. The app has no router, either.
- **Email confirmation on,** so nobody registers someone else's address and a typo is caught at once.
  Sign-up, reset and resend never say whether an address has an account.
- **A forgotten password:** email → code → new password, which comes before the lessons open. Saving
  it signs out the other devices.
- **«Выйти» is this device only** (`scope: local`, not Supabase's default of all devices), and stops
  reminders here: on a shared phone the next person must not get them. It works offline.
- **A token the API refuses (401) returns to the sign-in form.**
- **«Удалить аккаунт» removes everything, the login included.** The API now holds Supabase's secret
  key, reversing ADR 0009: it can manage every login, so it lives only in the host's secrets, and
  production refuses to start without it. It is the documented route; `DELETE FROM auth.users` would
  tie us to Supabase's internal tables.
- **Deleting is one all-or-nothing step:** data removed and flushed, then the login removed, then
  commit. If Supabase fails, everything rolls back and the learner can retry. A login already gone
  counts as deleted, so a retry finishes if the commit is what failed.
- **The password is asked again,** in the browser, and the API requires a sign-in under 10 minutes
  old (`amr` in the token; a token that doesn't say is refused). It can't be undone, and anyone can
  pick up an unlocked phone.
- **A deleted login can't come back as a blank account.** Tokens stay valid until they expire (an hour
  by default) and any valid token used to create a user. `deleted_logins` keeps the opaque id, is
  read only on the create path, and is swept at the next deletion a day or more later. Keep
  Supabase's JWT expiry under a day.
- **Decks nobody else has go with their author.** A deck given to a group stays, as does one somebody
  learned from even if its group is gone: their progress points at its words.
- **Passwords: minimum 8, no composition rules, «Показать».** OWASP says 15 without MFA, and leaked
  password checks are on Supabase's Pro plan. For schoolchildren on phones, 8 is a known deviation.
- **Tokens stay in `localStorage`,** Supabase's default; HttpOnly cookies would need a server-side
  session layer. The matching protection is a CSP, which is not built yet.

## Consequences
- Setup grows: Gmail with an app password, code templates, raised rate limits (`deploy.md`). A school
  shares one IP, and Supabase's default of 30 sign-ups per 5 minutes per IP would stop a class.
- **Gmail is the weak link.** Google can restrict an account that bounces a lot or looks automated,
  and sending can stop for up to a day. The way out is a domain, with no code change.
- A failed Supabase call means an account can't be deleted just then; the learner is told nothing
  changed.
- This covers accounts only. Whether the rest of the free stack holds 1,000 students (database size,
  egress, host CPU) is unproven and needs a load test.
- Not built: changing a password or email from settings, MFA, CAPTCHA, Google sign-in (blocked in
  embedded browsers such as Telegram's, where invite links travel). Consent for minors remains an
  open legal and school decision (`product-requirements.md`).
