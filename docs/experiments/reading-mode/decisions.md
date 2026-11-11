# Reading Mode: decisions

Each decision lists the options that were considered and why one was chosen. The owner's decisions
are marked ★ (November 2026).

## 1. Who sees it ★
Chosen: **a fourth tab «Чтение», for tester accounts only** (`READING_TESTERS`).
- Not everyone at once: the experiment should be tried by a few people first, in production, with
  real accounts.
- Not a row on home: reading is meant to become the main experience; a tab tests that honestly.

## 2. The basket ★
Chosen: **the article's own deck, created on the first «Добавить»; each word is a card at once.**
- **A local draft turned into a deck at the end** (the brief's literal wording): lost on another
  device, it needs new storage, and it duplicates what decks already do.
- **One shared «Из чтения» deck:** loses which article a word came from, and the basket per article.
- The deck **is** the basket, so removing a word is deleting its card, and «Создать карточки» becomes
  «Учить N слов». There's no second flashcard system and no schema change.

## 3. Languages ★
Chosen: **Russian only for now**, stored as a field per language so others can be added
([reading-mode-languages.md](../../product/reading-mode-languages.md)).

## 4. Content ★
Chosen: **free-licensed texts, credited** (VOA Learning English, Simple English Wikipedia, NASA),
plus 1–2 originals for gaps.
- BBC, National Geographic and similar are copyrighted: reproducing the text needs a licence.
- The Conversation (CC BY-ND) may be shown verbatim but **not adapted**, so it's only usable as-is
  at C1.
- Simple English Wikipedia adaptations remain **CC BY-SA**.

## 5. Where articles live
Chosen: **YAML in the repo → static JSON in `web/public/reading/`.**
- **Database tables and an API:** a migration, pagination and an editing tool, all for about eight
  curated texts. To revisit when articles are written by people outside the repo.
- **Bundled into the JS:** grows a chunk and ties content edits to code.
- Static files ship inside the Android app (offline from install) and are cached by the service
  worker on the website.

## 6. Meanings on tap
Chosen: **every word's meaning prepared per article and shipped with it**; common words come from
the course glossary.
- **An AI call per tap:** slow, costly, nothing offline, and unreviewed.
- **The existing `/api/glossary`:** covers course words only, and needs the network.
- A validator fails the build if any word lacks a meaning, so the reader never shows "no
  translation" for article text.

## 7. Making words tappable
Chosen: **a span per word, one delegated `click` listener on the article.**
- **A button per word** (as on flashcards): about 1,500 tab stops, heavier, and words look like
  controls.
- **Plain text + `caretRangeFromPoint` + the CSS Custom Highlight API:** the lightest DOM, but
  uneven on older Android WebViews and Samsung Internet. Kept for v2 if measurements call for it.
- `click` doesn't fire after a scroll or drag, which gives the "no accidental selection when
  scrolling" requirement for free.

## 8. Showing saved words
Chosen: **one generated `<style>` rule listing the basket's lemmas.** Saving a word restyles it
without re-rendering a 1,500-span article. The alternative, React state per word, re-renders the
article on every save.

## 9. The word sheet
Chosen: **a non-modal sheet at the bottom.**
- **The existing modal dialog:** its backdrop hides the text the learner is reading.
- **A popover beside the word:** cramped on phones, and covers the next lines.

## 10. Reading font
Chosen: **Literata** (variable, OFL, designed for long reading on screens; Latin subset, loaded by
the reader only).
- Considered: Source Serif 4, Lora, the system serif. Charter isn't available as a web font
  package.
- The interface stays Nunito.

## 11. Reading progress
Chosen: **on the device only** (localStorage per account) for the experiment.
- **Syncing it** needs a table and sync ops; to do if testers read on more than one device.

## 12. Finding the article's deck on another device
Chosen: **by an id map on the device, else the deck's exact title.** A renamed deck starts a new
basket.
- The robust fix, a nullable `decks.source` column (an additive migration), waits until the
  experiment proves itself.
