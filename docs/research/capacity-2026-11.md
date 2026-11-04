# Can the free setup hold 1,000 students?

Measured 4 November 2026 with `backend/loadtest`. **Short answer: the data now fits, and login fits.
The free server holds about 15 students studying at the same moment on this test, and no longer falls
over past that, but it has not been measured on the real host. Database traffic is the open risk.**

## How it was measured
- **Students:** 1,000 made-up students in classes of 30, with 180 days of history, each studying 20–80%
  of days: a lesson of about 20 cards, half the days some spelling.
- **Server:** one real uvicorn process, paused and resumed to hold it to a share of one CPU, as a free
  host does (Koyeb's documented free instance: 0.1 vCPU, 512 MB).
- **Database:** real Postgres behind a small proxy adding 2 ms each way and counting bytes.
- **Behaviour:** simulated students make the web app's real requests: open the app, a deck's page, a
  lesson with 2–5 seconds per card, then sometimes friends and progress. Requests give up at 15 seconds,
  like the app.

### What this does not show
- **It ran on an Apple M1, faster than a shared cloud CPU.** The stricter 0.05 CPU run is the guide to
  how much worse a real host could be. Only a run on the deployed host settles it.
- Postgres was not limited, while Supabase's free database is small and shared.
- Development sign-in was used, so checking real tokens and TLS are not in the CPU figures.
- The students are synthetic. The share who study, and when, are assumptions.

## Results
At 0.1 CPU, 240 seconds each. "Failed" means no answer: a timeout, or still refused after retries.

| At once | | Lessons finished | Failed | Answering a card, typical / slowest 5% | Opening «Мои колоды», typical / slowest 5% |
|---|---|---|---|---|---|
| 10 | before | 12 | 1 of 720 | 0.7 s / 1.2 s | 2.4 s / 5.0 s |
| 15 | after | 16 | 0 of 1,115 | 0.7 s / 1.6 s | 2.4 s / 6.7 s |
| 30 | before | 30 | 2 of 1,579 | 1.2 s / 5.9 s | 5.8 s / 11.2 s |
| 30 | after | 29 | 36 of 1,674 | 1.2 s / 5.1 s | 4.8 s / 10.9 s |
| 60 | before | **0** | **1,860 of 1,932** | no answers | no answers |
| 60 | after | 27 | 588 of 2,519 | 2.5 s / 8.8 s | 6.8 s / 11.6 s |

- **The ceiling is the server's CPU:** about 18 ms a request on this machine, so roughly 5 requests a
  second at 0.1 CPU. A student in a lesson makes about 0.3 a second.
- **Before, overload meant total collapse,** because requests the student had given up on kept running.
  Now the server refuses what it can't start, and the app retries (ADR 0044). The price: at 30 students
  more requests end up refused (36) than before (2), though they answer no faster or slower.
- **At 0.05 CPU with 30 students** nothing finishes, before or after (the after run used a limit of 12).
  It does keep answering afterwards, where the first run stopped altogether. If a real host behaves
  like that, a whole class at once will not work on it.
- Memory is no concern: 60–100 MB of 512 MB.

## What that means for 1,000 students
Assume 30% study on a given day, for 5 minutes each, within a 2–3 hour evening: **about 8–12 at once.**
That is inside what was measured, if a real host is no worse than half as fast. **A whole class of 30 at
the same moment works but is slow, with screens taking 5–10 seconds.** Several classes at once would be
turned away a lot, though the server stays up.

## Database size
| After 180 days | Before | After cleanup |
|---|---|---|
| Database | 871 MB | 249 MB |
| Answers | 1.91 million | 343,000 |
| Free limit | 500 MB | 500 MB |

- Run nightly from the start, tables never grow to the "before" size, so the database doesn't need to
  shrink; plain Postgres vacuuming reuses the space. The 249 MB was measured after `VACUUM FULL`.
- Still growing, slowly: word progress with the words each student meets (81 MB here, limited by the
  words there are), lesson rows without their plans (about 14 MB per half year at this activity).
- The first cleanup, of all 180 days at once, took 24 seconds at full CPU.

## Traffic from the database: the open risk
Supabase's free plan includes 5 GB of egress a month. Reads from the API appear to count.

- **Per request:** 20.7 KB before, 13.5 KB now, mostly from the friends screens (240 KB to 42 KB a view).
- **Per lesson:** up to about 0.9 MB as driven here, which also counts unfinished lessons and extra looks.
- **A month, at 30% studying daily:** about 6–8 GB, **over the limit.** At 20% it about fits. TLS overhead
  isn't counted.

The largest remaining reads per view: `deck_stats` 31 KB, `progress` 27 KB, `pace` 25 KB, `library` 15 KB
over 30 queries. Rereading a lesson's earlier answers is not worth changing: removing it moved traffic and
CPU by under 5%, so it was reverted. **Watch Supabase's usage page during the pilot.**

## Waking up
A free host sleeps when idle. Start-up took 26–29 seconds at 0.1 CPU, now 17–18, because the `openai`
library is loaded only when drafting. The image also runs migrations and reloads the course on every
start; those took 2.2 seconds at full CPU, so about 20 more at 0.1. That is **more than the app's
15-second limit,** so the first visit after a quiet spell can fail. An outside scheduler calling the app
keeps it awake; the Koyeb figure of an hour idle comes from secondary sources, and Render sleeps after 15
minutes.

## Sending notifications
Everyone in one zone is due within minutes (ADR 0042). Over this database, with real encryption but no network: 25 queries and about
15 ms of CPU a phone. At 0.1 CPU, with database and push-service round trips, **an estimated 0.5–0.7 seconds a phone,** so 80–100 in
a 50-second run, or about 200 in the morning window and 300 at 17:00 with hourly runs. Past that, the last in the order miss that window.

## Next, in order
1. **Run this on the deployed free host,** before a class. It replaces the biggest assumption here.
2. **Read less per screen** (`deck_stats`, `progress`, `pace`, `library`), for both traffic and CPU.
3. **If the real host can't hold a class,** more CPU is the fix, and nothing here needs rewriting. Paid
   instances were about $5–7 a month in the October research; re-check before relying on that.

## Running it
```sh
createdb vocab_load
export DATABASE_URL=postgresql+psycopg://localhost/vocab_load
cd backend && uv run alembic upgrade head
uv run python -m app.cli load-content ../content/a1-a2 ../content/b1-b2 ../content/c1
uv run python -m loadtest.seed --students 1000 --days 180
uv run python -m app.cli clean-up   # to measure with the cleanup
uv run python -m loadtest.run --students 15 --cpu 0.1 --seconds 240
```
The tools refuse any database whose name doesn't end in `_load`, since the seed empties it.
