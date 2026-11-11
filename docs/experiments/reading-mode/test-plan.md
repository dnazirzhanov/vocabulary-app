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
| Main chunk, gzipped, before → after | Δ < 1 KB | _tbd_ |
| Reader requests on home | 0 | _tbd_ |
| Requests per word tap | 0 | _tbd_ |
| Tap → sheet visible | < 100 ms | _tbd_ |
| Long tasks while scrolling, 4× CPU slowdown | none > 50 ms | _tbd_ |
| DOM elements, 1,200-word article | ≈ words + 200 | _tbd_ |

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
