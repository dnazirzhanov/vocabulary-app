# Hosting, database and sign-in options for the pilot

Researched 25 October 2026 for Phase 4. Prices and limits change; the figures below were checked
against official pricing pages where noted, otherwise against recent third-party sources (marked).
Re-check before creating accounts.

**Constraints (decided):** free tiers only · email self sign-up · learners may be minors ·
learners in Kyrgyzstan · FastAPI + PostgreSQL (ADR 0002) · nothing deployed or bought without approval.

## The three options

|                                  | A. Supabase                                                                                                | B. Neon                                                                  | C. Self-host on a free VM                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Sign-in                          | Supabase Auth (mature; email + password, verification, reset); 50,000 monthly users free                   | Managed Better Auth (newer); up to 60,000 monthly users per project free | Our own, using a library (`fastapi-users` is in maintenance mode: security fixes only) |
| Where users are stored           | Our own Postgres (`auth` schema)                                                                           | Our own Postgres (`neon_auth` schema)                                    | Our own Postgres                                                                       |
| Token check in FastAPI           | Asymmetric signing keys + public JWKS endpoint (documented)                                                | EdDSA tokens + public JWKS endpoint, 15-minute expiry (documented)       | Our code                                                                               |
| Database (free)                  | 500 MB per project, 2 projects                                                                             | 1 GB per project                                                         | Whatever the VM holds                                                                  |
| Idle behaviour                   | **Project pauses after 1 week without activity**; restored by hand                                         | Compute sleeps after 5 minutes idle; wakes on the next query             | Always on                                                                              |
| Backups (free)                   | **None** (no automatic backups, no point-in-time recovery)                                                 | 6 hours of restore history (1 GB), 1 manual snapshot                     | Ours to build                                                                          |
| Emails (sign-up, password reset) | Built-in sender is capped at about 2 per hour → **must add an email provider**                             | Not documented on the overview page → verify with a test project         | Ours to build                                                                          |
| Data export                      | Standard `pg_dump`                                                                                         | Standard `pg_dump`                                                       | Standard `pg_dump`                                                                     |
| Operations work                  | Low                                                                                                        | Low                                                                      | **High**: OS updates, TLS, backups, monitoring, security                               |
| Known risks                      | ISPs in some countries (India, UAE) have blocked `*.supabase.co` in the past; nothing found for Kyrgyzstan | Auth product is young                                                    | Free VM sign-up and capacity are unreliable; everything security-related is on us      |

Both A and B keep all data in a standard PostgreSQL database we can dump and move, so switching
later costs a migration, not a rewrite. Option C is the cheapest on paper and the most expensive in
time and risk; it is not recommended without someone to run it.

## Running the API (needed for A and B)

The web app can be served by the API itself (one service, no CORS). Free hosts close to Kyrgyzstan
(Frankfurt is roughly 70–100 ms away; US regions 200+ ms):

| Host                                   | Free tier                                | The catch                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render (third-party sources)           | Free web service, Frankfurt              | **Sleeps after 15 minutes idle; waking takes about a minute** — longer than the app's 15-second request timeout. Its free Postgres expires after 30 days (we would not use it). |
| Koyeb (third-party sources)            | One 512 MB / 0.1 vCPU service, Frankfurt | Sleeps after 1 hour idle; wakes in 1–5 seconds. Reports since February 2026 of a card and a $29 hold at sign-up (conflicting).                                                  |
| Google Cloud Run (third-party sources) | Generous request allowance               | Free allowance only in US regions; billing account (card) likely required.                                                                                                      |

**Free hosting means the first visit after a quiet period is slow.** The client can show "Подключаемся…"
and allow a longer first request, but the honest fix is an always-on instance (about $5–7 a month).

## Costs that are hard to avoid even on free tiers

- **A sending domain (~$10–15 a year)** for sign-up and password-reset emails. Free email providers
  (Brevo: 300 emails/day; Resend: 3,000/month, 100/day — third-party figures) need a verified
  domain for reliable delivery; sending "from" a Gmail address through them is rejected or lands in
  spam. A school's existing domain could be used instead, with its owner's help.
- **Our own backups** on free plans: a nightly encrypted `pg_dump` stored outside the provider, and
  a restore test before the pilot.

## Legal: personal data of learners in Kyrgyzstan (not legal advice)

- The 2008 law «Об информации персонального характера» **stopped applying on 5 February 2026**; its
  role passed to the **Digital Code** (№ 178 of 31 July 2025), including articles on personal-data
  protection (art. 89) and **cross-border transfer** (art. 90). Hosting in the EU or US is a
  cross-border transfer; a procedure for judging other countries' "adequacy" is being prepared.
- Fines for violations, including cross-border transfer, were raised in 2025.
- The old law did not accept a ticked checkbox as consent (written or electronically signed form
  required). Whether the Digital Code changes this, and **who consents for a minor and from what
  age, was not clear from available sources** — the drafters of a separate data-protection bill
  themselves called children's data under-regulated.

**Consequence:** email self sign-up collects an email address from every learner. Before real
students — and especially minors — sign up, get an answer from the State Agency for Personal Data
Protection (ГАЗПД) or a lawyer on consent, minors and cross-border hosting. Until then, test with
adult volunteers.

## Recommendation

**Option A, Supabase, in the Frankfurt region**, for the sign-in flows learners actually need
(confirmation, password reset) on the most mature free auth of the three, with users kept in our own
Postgres and tokens verified locally in FastAPI. Accept and mitigate its free-tier gaps:

1. add an email provider (Brevo or Resend) and a sending domain;
2. run our own nightly encrypted backups and test a restore;
3. rely on daily pilot use to avoid the one-week pause (restore by hand if a holiday triggers it);
4. host the API on Koyeb (Frankfurt) if it signs up without a card hold, otherwise Render, with a
   clear "waking up" state in the app.

Choose **Option B, Neon**, instead if a test project shows its managed auth sends verification and
reset emails without extra setup — it avoids the one-week pause and includes short restore history.

Before creating accounts: open a test page hosted on each candidate from a network in Kyrgyzstan
(a teacher or pilot learner can do this) to rule out regional blocking.

## What can be built now, whichever provider is chosen

Provider-independent Phase 4 work: account deletion (cascades already exist), rate limits on
answers and sign-in–adjacent endpoints, a container image that serves API + web, production
settings validation, a JWT verification module that only needs the provider's JWKS URL and issuer,
and the backup/restore scripts.

## Sources

- Supabase pricing (official): https://supabase.com/pricing
- Supabase JWT signing keys (official): https://supabase.com/docs/guides/auth/signing-keys
- Supabase regional network blocks (official blog): https://supabase.com/blog/navigating-regional-network-blocks
- Supabase default SMTP limits: https://developers.brevo.com/docs/supabase-smtp-integration ·
  https://sendlayer.com/blog/supabase-custom-smtp-and-email-configuration-guide/
- Neon pricing (official): https://neon.com/pricing
- Neon Auth overview and JWT plugin (official): https://neon.com/docs/auth/overview ·
  https://neon.com/docs/auth/guides/plugins/jwt
- Render free tier: https://bex.co/blog/2026/09/23/render-free-postgres-30-day-expiry ·
  https://agentdeals.dev/vendor/render
- Koyeb free tier: https://www.srvrlss.io/provider/koyeb/ · https://www.koyeb.com/docs/reference/instances
- Google Cloud Run free tier: https://agentdeals.dev/vendor/google-cloud-run ·
  https://cloudchipr.com/blog/cloud-run-pricing
- fastapi-users status: https://openapps.pro/packages/fastapi-users
- Email providers: https://dreamlit.ai/blog/brevo-review · https://wpmailsmtp.com/resend-review/
- Digital Code of the Kyrgyz Republic and personal data: https://www.icnl.org/wp-content/uploads/KG-Personal-Data-Guidance-Note_Digital-Code_February-10-2026_RU.pdf ·
  https://reestr.dpa.gov.kg/ru/npa/59 · https://continent-online.com/Document/?doc_id=37462686 ·
  https://wcr-consulting.com/blog/2026/05/10/kyrgyzstan-personal-data/ ·
  https://reestr.dpa.gov.kg/ru/npa/42
