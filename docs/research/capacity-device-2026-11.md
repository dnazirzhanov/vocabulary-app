# Studying on the device: what it costs the server

Measured 9 November 2026 with `backend/loadtest` (`--device`), the same way as `capacity-2026-11.md`:
- **Data:** 1,000 synthetic students with 180 days of history, cleaned up.
- **Server:** one uvicorn held to 0.1 of a CPU on an Apple M1.
- **Database:** Postgres behind a proxy adding 2 ms each way.
- **Load:** 240 seconds a run, the same students every run.

**The old way** is a request for every card (the web app until #80). **The device way** is what the web app does since #80:
- opening a deck's page is a sync (the decks, then the study pack);
- the lesson makes no request between cards;
- answers go in pushes of at most 10;
- the end of the lesson is pushed with the last answers, then a fresh pack.

## Results
| At once | Way | Lessons finished | Failed requests | Server CPU per lesson | Database traffic per lesson |
|---|---|---|---|---|---|
| 15 | old | 19 | 0 | 1.14 s | 0.61 MB |
| 15 | device, one push per lesson | 16 | 30 | 1.51 s | 1.74 MB |
| 15 | **device, pushes of 10 (shipped)** | **19** | **0** | **1.57 s** | **1.62 MB** |
| 30 | old | 14 | 54 | 2.43 s | 1.03 MB |
| 30 | device, one push per lesson | 31 | 148 | 1.17 s | 1.20 MB |
| 30 | device, pushes of 10 | 12 | 109 | 2.93 s | 3.21 MB |

"Lessons finished" counts lessons the student got to the end of. In the one-push rows many of those
pushes failed (timed out), so they overstate what reached the server.

Typical / slowest 5%, at 15 at once:

| Request | Old way | Device way, pushes of 10 |
|---|---|---|
| answering a card | 0.7 s / 1.6 s, the learner waits | none: answered on the device |
| a push of 10 answers | — | 13.8 s / 19.8 s, in the background |
| the study pack | — | 3.0 s / 7.6 s |
| «Мои колоды» | 2.7 s / 5.5 s | 3.8 s / 8.6 s |
| «Прогресс» | 1.2 s / 3.1 s | 1.9 s / 5.8 s |

## What it means
- **A regression found and fixed here: a whole lesson's answers in one push.** That push took over 30 seconds at 0.1 CPU, and 13 of 16 failed at 15 students at once. Each answer is re-applied with the full rules, about what one online answer costs, so 35 together outran the request's time limit.

  The server finished the work anyway, and the device then got the stored results, so nothing was lost. But the lesson's end waited, and the repeats wasted CPU. A push now carries at most 10 answers, and goes as soon as 10 are waiting (`web/src/local/batch.ts`). With that, 15 at once finish as many lessons as the old way, with no failures.
- **Pilot-sized load (5–10 students) is well inside this.** Learners no longer wait for the server between cards, and studying works without a connection.
- **The server works more per lesson: about 38% more CPU and 2.7 times the database traffic.** Most of it is the study pack, which is built whole for every request (all the words of every deck, all progress) and fetched on each deck page and after each lesson; the tag saves the download, not the building.
- **A whole class at once (30)** was already past this server's share the old way, and is somewhat worse now: fewer lessons finished, more refusals.
- **Database traffic, at 30% of 1,000 students studying daily:** about 1.6 MB a lesson, roughly 15 GB a month, against Supabase's free 5 GB. The old way was about 6–8 GB. **Fine for the pilot (about 0.5 GB a month for 10 students); must be cut before growing.**

## Before growing past the pilot, in order
1. **A smaller pack.**
   - Words change rarely: send them separately, tagged by the decks' versions, and the pack only progress, the ladder and pace.
   - Check the tag before building: a cheap fingerprint of my progress and decks, then 304 without the build.
2. **A cheaper push:**
   - one commit per request instead of one per operation, each operation still in its own savepoint;
   - the lesson's earlier answers read once per request, not once per answer.

   Both are hypotheses until measured.
3. **Re-measure on the real host** (`capacity-2026-11.md`, step 1).

## Running it
As in `capacity-2026-11.md`, with `--device`:
```sh
uv run python -m loadtest.run --device --students 15 --cpu 0.1 --seconds 240
```
