# Reading Mode: test plan

Every item gets a test that **fails without the feature** (checked by planting the old behaviour
back where it makes sense), and the existing suites stay green. Results and measured numbers are
filled in below as each phase lands.

## Content (backend, `tests/test_reading_content.py`)
- Every word token of every article has a meaning (article glossary, else `content/glossary.yaml`).
- `level` ∈ A1–C1, `topic` known, `source` has a name, URL and licence; `id` unique and stable.
- The committed `web/public/reading/*.json` equals what the YAML builds to.

## Back end
- `MeOut.reading` is true only for accounts in `READING_TESTERS` (bare UID and `supabase|<UID>`),
  false otherwise; old clients ignore the field.
- The full existing suite (`uv run pytest`) passes. `make check` does not run it.

## Unit (web, `node --test`)
- Tokenizing a paragraph keeps punctuation and spacing, handles contractions (*don't*, *it's*),
  possessives, hyphenated words and repeated words.
- Form → entry lookup, lemma vs surface form, case.
- Basket dedupe by lemma (*bees* and *bee* are one entry).
- Reading time and word count.
- Progress writes are throttled and keyed per account.

## End to end (Playwright)
**App project:**
- The library loads, filters by level, opens an article; back returns to the library.
- **Tapping a word:**
  - shows its meaning, explanation and sentence, **with no network request**;
  - a scroll gesture over words opens nothing.
- **The basket:**
  - «Добавить» → the count is 1, the deck exists with that card (headword = lemma, example = the
    sentence);
  - the same word, or another form of it → «В корзине», count unchanged;
  - «Убрать» → 0;
  - **«Учить N слов» starts a lesson with exactly those words.**
- **Finishing:** «Готово» → ✓ in the library.
- **Testers only:** a non-tester sees no «Чтение» tab.
- **Isolation:** another account never sees the first account's reading deck.
- **States:** a missing or broken article file shows a message and «Повторить»; the library's
  empty level shows a short line.
- **Responsive:** 320, 390 and 1280 px: no horizontal overflow, top bar and sheets usable.

**Offline project:**
- An article opened once reads offline; a word saved offline reaches the server once online.
- The whole existing offline suite passes.

**Sign-in project:** passes unchanged.

## Performance (numbers recorded here in Phase 4)
| Measure | Budget | Result |
|---|---|---|
| Main chunk, gzipped, before → after | Δ < 1 KB | App 81,698 → 82,057 B, index 84,167 → 84,440 B: **+632 B** (phase 2) |
| Reader requests on home | 0 | **0** (e2e: no `/reading/`, font or reader chunk request on home) |
| Requests per word tap | 0 | **0** (e2e and the measurement) |
| Tap → sheet visible | < 100 ms | **81 ms** first tap, **14–17 ms** after (4× CPU slowdown, *Why Is Mars Red*) |
| Long tasks while scrolling, 4× CPU slowdown | none > 50 ms | **none**, the whole article in 120 px steps |
| DOM elements, reader page | ≈ words + 200 | **592** for 483 words (*Why Is Mars Red*) |

## Device
- **Android emulator, release build:**
  - the tab appears for a tester account;
  - an article opens offline (the files are inside the APK);
  - 🔊 on a word speaks (the phone's voice);
  - the sheets sit above the gesture bar.
- **The owner's phone**, before testers get it.

## Regressions to re-check every phase
- **Lessons, spelling and offline studying** work as before (the existing e2e suites).
- **Home:** a reading deck appears in «Мои колоды» and studies like any deck.
- **Service worker:** the shell and audio caches are untouched.

## Phase 2 results
- **Reader chunk** (loaded only when opened): 3.4 KB JS + 2.1 KB CSS gzipped. The Literata Latin
  font (52 KB woff2) is requested only after an article opens (e2e).
- **Contrast**, measured: body text 13.3:1 (Бумага), 10.4:1 (Сепия), 11.4:1 (Ночь); muted text
  5.7–6.5:1.
- **Screens:** 320, 390 and 1280 px, with no horizontal overflow. The bottom bar now takes four
  tabs in one row.
- **Tests:** e2e `reading.spec.ts` (4) and `offline-reading.spec.ts` (1); backend
  `test_reading_mode_is_shown_to_the_testers_only`; the full app, offline and sign-in suites
  (127) pass.

## Phase 3 results
- **Bundle:** the main chunks are unchanged since phase 2 (82,039 and 84,399 B gzipped). The reader
  chunk is now 7.2 KB JS + 3.3 KB CSS gzipped, loaded only when an article opens.
- **Screens:** library, word sheet, basket, selection bar, note editor and notes list at 320, 390
  and 1280 px, with no horizontal overflow.
- **Found by the screenshots and fixed:** a selection made while a word sheet was open offered
  nothing, and Esc did not close the sheet (decision 18). The e2e test failed before the fix.
- **Tests:** `text.test.ts` (4 unit: pieces, snapping, highlight runs, the saved sentence);
  `reading.spec.ts` (8 e2e: topics and level; five then «Показать ещё»; look, place and finish;
  tap with no request, add, duplicate, a name not saveable, remove, «Учить · 1 слово» starts a
  lesson; highlights and notes kept per article after a reload; home loads nothing; a missing
  article; a non-tester). The full app, offline and sign-in suites (131), backend (623) and unit
  (127) pass.

## Phase 4 results
- **A word saved online now reaches the server within seconds.** Before, it waited on the phone
  until the app was next opened or came back online: the reader never asked the outbox to send, as
  the deck editor does. Found by the new offline test, which failed before the fix.
- **Offline project** (`offline-reading.spec.ts`, 3): an article read once opens offline; a word
  saved offline is in the article's deck on the server once online; another account on the same
  device sees no reading words and no deck of the first.
- **Android emulator** (debug build against this computer's API, Android 16):
  - the tab shows for a tester; the article, the reader font and the word sheet work;
  - with the server cut off, the app restarted and opened an article never opened before (it ships
    inside the APK), and a word was saved; it reached the server after the app came back to the
    front;
  - 🔊 speaks through the phone's voice (the TextToSpeech plugin, en-US);
  - the sheet sits above the gesture bar.
- **Speed on slower devices:** the emulator runs JavaScript about 18× slower than this computer
  (223 ms against 12 ms on the same loop), well below a real phone. On it a tap shows the sheet in
  80–250 ms, mostly script and painting. On this computer at 10× CPU slowdown, a tap that opens
  the sheet takes 19–51 ms, and the first tap 23–26 ms at 4×. A real low-end phone is the
  remaining check, on the owner's phone with the next APK.
- **CI found what the local run could not:** CI tests a production build, where the service worker
  fetches articles itself. Tests that fake a missing article or a longer library now block the
  service worker; the offline project covers it.
