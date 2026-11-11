# Reading Mode: architecture (experiment)

What it reuses, what it adds, and why. The product side is in [reading-mode-spec.md](reading-mode-spec.md);
the decisions with their alternatives are in [decisions.md](../experiments/reading-mode/decisions.md).

## In one paragraph
- **Articles** are **static files**: YAML in `content/reading/`, built into JSON in
  `web/public/reading/`. They ship with the website and **inside the Android app**, so there is no
  database table, API or migration.
- **Meanings:** each article carries the meaning of **every word in it**, prepared and reviewed in
  advance, so a tap is a lookup on the device, with no request at all.
- **Saved words** go into an ordinary **deck of the learner's own**, through the existing
  offline-first deck code and sync. The flashcards, scheduling and lessons are the ones the app
  already has.
- **The backend** changes in one place: a flag on `/api/me` that shows the tab to testers.

## Reused, unchanged
| Need | Existing piece |
|---|---|
| Split text into words (contractions, apostrophes) | `web/src/lib/tokens.ts` `tokenize()` (mirrors `TOKEN` in `backend/app/services/content.py`) |
| Meanings of common words | `content/glossary.yaml` (forms → `ru`, `lemma`, `note`); the build step copies what an article needs |
| A deck and its cards, offline-first and synced | `web/src/local/myDecks.ts` `createDeck`, `addCard`, `removeCard`, `deckCards`; sync ops `deck.create`, `card.create`, `card.delete` |
| No duplicate word in a deck | `addCard` refuses a repeated headword (`word_in_deck`) |
| Keep progress on course words | the server links a card with a course word's spelling and part of speech instead of copying it |
| Flashcards and scheduling | `study.startStudySession(deckId)` (lessons on the device, ADR 0062) |
| «Уже учите» | the study pack on the device (`study/state.ts`, `learner.words`) |
| Pronunciation | `lib/audio.ts` `playAudio` (recordings, else the browser's or phone's voice) |
| Lists, sheets, the size picker | `ui/List.tsx`, `ui/Dialog.tsx`, `ui/NumberChoice.tsx`, `styles/tokens.css` |
| Showing something to some accounts only | the `CONTENT_EDITORS` pattern: setting → `/api/me` boolean → UI |

## Added
### Content: `content/reading/<id>.yaml` → `web/public/reading/<id>.json`
**The source an editor writes:**
```yaml
id: how-bees-dance            # stable: progress and the basket refer to it
title: How Bees Talk by Dancing
subtitle: Honeybees tell each other where food is, without a single word.
topic: nature                 # science | technology | nature | society | psychology | history | culture
level: B1                     # A1 | A2 | B1 | B2 | C1
source: {name: VOA Learning English, url: https://…, license: public domain}
body:                         # paragraphs; "## " starts a heading
  - "## A dance with a message"
  - "When a honeybee finds flowers, it flies back to the hive and dances."
glossary:                     # every form in the text not in content/glossary.yaml
  dances: {lemma: dance, pos: verb, ru: танцует, def: moves the body to music or in a pattern}
  hive:   {pos: noun, ru: улей, def: a home that bees live in}
```

**What the build adds:** `content/tools/build_reading.py` writes the JSON the app reads. It adds:
- the forms the article uses from `glossary.yaml`;
- the word count and the minutes to read (about 180 words a minute at A2–B1, 220 at B2–C1);
- the library index, `index.json`: `id, title, subtitle, topic, level, minutes`, newest first.

The JSON is committed, so the app build needs no Python.

**What the validator checks** (a backend test that `make check` runs):
- every word in every article has a meaning;
- levels and topics are known;
- each source has a name, a link and a licence;
- the committed JSON is what the YAML builds to.

**Size:** an article of about 1,200 words is around 30 KB of JSON (about 8 KB gzipped). A
library of 200 articles has an index of about 40 KB; beyond that, split the index by level.

### Front end: `web/src/reading/` (one lazy chunk)
- **Loading:** `App.tsx` gets two screens, `reading` (the library) and `article`, rendered through
  `lazy(() => import('./reading/ReadingRoutes.tsx'))`. **Nothing of the reader**, not its code,
  its CSS or its font, loads on any other screen.
- **The tab:** `NavShell` gets the fourth tab, shown when `/api/me` says `reading: true`.
- **Library:** fetches `index.json` once per visit (a module-level cache). Level chips, then topic
  sections in the `ListSection` style. Each article row shows its progress from localStorage.
- **Reader:**
  - fetches `<id>.json`, then splits it into paragraphs of tokens **once** (`useMemo`);
  - the article is a memoised component that **never re-renders** after the first paint;
  - each word is a `<span data-f="form" data-l="lemma">`, styled exactly like text;
  - **one** `click` listener on the article handles every word (event delegation);
  - a browser doesn't fire `click` after a scroll or a drag, so scrolling never opens a word, and
    a tap while text is selected is ignored;
  - the tapped word gets a class through a DOM ref (no React state);
  - words in the basket are marked by **one generated `<style>`**, `[data-l="hive"],[data-l="dance"]{…}`,
    so saving a word restyles the text without re-rendering it.
- **Word sheet:**
  - a **non-modal** sheet at the bottom, about 35% of the height: the text stays visible and
    scrollable above it;
  - the article gets bottom padding while it's open, so the tapped line can be scrolled clear;
  - the meaning is a `Map` lookup, with no request.
- **Basket:**
  - **deck:** the article's deck is created on the first «Добавить» (`createDeck(title, 'ru')`);
  - **finding it again:** its id is kept per account in localStorage under the article id; on
    another device the deck is found by its exact title among my decks;
  - **cards:** `addCard({headword: lemma, pos, translation: ru, example: sentence, language: 'ru'})`;
  - **the basket sheet:** lists `deckCards()`, refreshed on the existing local-change signal.
- **Progress:**
  - an `IntersectionObserver` on paragraphs (no scroll handler reads layout);
  - written to localStorage at most once a second, `{articleId: {pct, finishedAt}}`, per account;
  - kept on the device only during the experiment.
- **Font:** **Literata**, variable, Latin subset (`@fontsource-variable/literata`, about 50 KB
  woff2), imported by the reader chunk only, with `font-display: swap`.
- **Themes:** the reader's own colour tokens (Бумага, Сепия, Ночь), set on the reader's root
  element. The app keeps `color-scheme: only light` everywhere else.

### Service worker: `web/public/sw.js`
A `/reading/` branch next to `/audio/`: cache-first into `reading-1`, filled when an article is
first opened. An article read once on the website opens offline afterwards. In the Android app the
files are inside the APK already. Existing caches, and how the app syncs, don't change.

### Back end: one flag
- **Setting:** `READING_TESTERS` in `core/config.py`, auth subjects separated by commas (a bare
  Supabase UID or `supabase|<UID>`, as with `CONTENT_EDITORS`).
- **API:** `MeOut.reading: bool`, an additive field that older apps ignore.
- **Data:** no table, migration, API route or sync change.

## Performance budget (measured in Phase 4, recorded in the test plan)
| What | Budget | How it's measured |
|---|---|---|
| Main JS chunk growth | < 1 KB gzipped | `vite build` sizes before and after |
| Reader files loaded on other screens | 0 | Playwright network log on home |
| Requests per word tap | 0 | Playwright: no request during a tap |
| Tap → sheet visible | < 100 ms | Playwright timing |
| Scrolling a long article | no task > 50 ms at 4× CPU slowdown | Playwright performance trace |
| Article DOM | about one element per word | element count on a 1,200-word article |
| Font | one woff2, reader only | network log |

## Risks and regressions to watch
- **Lots of decks:** every article a learner saves from becomes a deck. With the limit of 100 decks
  per user that's fine for an experiment. If reading takes off, group the reading decks on home (or
  under one «Из чтения» section) before the limit matters.
- **Finding the deck on another device:** it's found by title. If the learner renames the deck,
  a new one is started for that article. That's acceptable for the experiment. The fix later is a
  nullable `source` column on decks, which would be an additive migration.
- **Home:** basket decks appear in «Мои колоды» like any deck. That's intended (they are what was
  read), but it's worth watching.
- **The tab:** a fourth tab narrows the bottom bar. It has to be checked at 320 px.
- **Service worker:** a change to it reaches every user, testers or not. The `/reading/` branch is
  isolated, and the offline e2e suite must stay green.
- **Content:** a wrong meaning teaches a wrong word. Glossaries are reviewed like the course, and
  readers can report a card from the basket (existing card reports).
