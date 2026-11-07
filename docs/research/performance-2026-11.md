# What the app sends and runs per screen (7 November 2026)

Measured to compare with `capacity-2026-11.md`, before and after PR «m65-performance».

## How
- **The production build**, served by FastAPI as the Docker image does (`WEB_DIST`), on a laptop, against the local development database. Dev auth.
- **A scripted Chromium** (`390×844`, browser cache on) walks a new learner through the screens.
  - **"Wire"** is bytes received: headers plus the body as sent, so compressed when it was.
  - **"Queries"** comes from the new `X-Query-Count` header: the SQL statements each request ran (counted by the engine listener in `core/db.py`). The old code has no counter, so its column is empty.
- **Before** is the code of PR #73 run from a separate checkout; **after** is this PR. The web build is the same for both.

| Step | API before | API after | Files before | Files after | Queries |
|---|---|---|---|---|---|
| First visit (nothing cached) | 4 req, 2.5 KB | 4 req, 2.0 KB | 8 req, **645.6 KB** | 8 req, **226.2 KB** | 22 |
| Second visit (reload) | 4 req, 2.5 KB | 4 req, 2.0 KB | 1.3 KB | 0.9 KB | 20 |
| Open a deck | 4 req, 2.5 KB | 4 req, 2.0 KB | none | none | 39 |
| Start a lesson | 2 req, **52.2 KB** | 2 req, **12.1 KB** | 17.7 KB (audio) | 17.9 KB | 18–19 |
| Rate one card | 1 req, 0.7 KB | 1 req, 0.6 KB | 9.1 KB (audio) | 9.1 KB | 9 |
| Open «Друзья» (no groups) | 1 req, 0.2 KB | 1 req, 0.3 KB | none | none | 2 |

The same walk: time until «Мои колоды» showed was 300–490 ms cold and 130–155 ms on reload, both before and after. This was a local machine with no network delay, so the time saved over a phone connection doesn't show here; the bytes are what to read.

## What changed and what it did
- **Compression** (`GZipMiddleware`, level 5): the first visit is 65% smaller (646 → 226 KB). The glossary is 52 → 12 KB. Audio and fonts are excluded, since they are already compressed.
- **The glossary is tagged** (`ETag`). It was already fetched once per page load; now a browser that has it gets `304 Not Modified` on the next visit and downloads nothing (tested in `tests/test_http_caching.py`).
- **Built files are kept for good** (`immutable`, a year), and audio and icons for a week. The old server already allowed revalidation (`ETag`/`Last-Modified`), so in Chrome a reload already cost only about 1 KB. The gain is that kept files need no round trip at all. It matters most on slow phone networks and is not visible here.
- **Indexes** on `word_id` in progress, spelling, answers and deck links. A lookup by word now uses the index (`EXPLAIN ANALYZE`: an index scan, 0.2–10 ms on the dev data) where it read the whole table before. This matters when a word or deck is deleted, not for studying.

## Against the capacity study
- **The number of requests is unchanged.** CPU per request, the bottleneck found in `capacity-2026-11.md`, is unchanged apart from the small cost of compressing. This PR saves bandwidth (the egress risk there), not CPU.
- **Queries per screen**, now visible for the first time:
  - opening a deck: 39 queries in 4 requests;
  - home: 20–22 queries in 4 requests;
  - an answer: 9 queries.

  These match the earlier finding that `deck_stats`, `pace` and `library` are the heavy reads. They are the next thing to cut if the real host is slow, and the offline work (reading from the device) removes most of these requests for screens already seen.

## Not measured here
- A real phone over a real network.
- The deployed host.
