# Reading Mode: product spec (experiment)

**Status:** experiment, shown only to tester accounts (`READING_TESTERS`). The architecture is in
[reading-mode-architecture.md](reading-mode-architecture.md); languages beyond Russian are in
[reading-mode-languages.md](reading-mode-languages.md).

## Why
Slovar is moving from vocabulary drills toward **learning English through reading**:

**Read → Understand → Save vocabulary → Think → Express.**

Reading is the main experience; saving words and the existing flashcards support it. This
experiment builds the first three steps. *Think* and *Express* come later.

## What we build
1. **A library**:
   - a few curated articles grouped by topic (Наука, Природа, Технологии, Общество, Психология,
     История, Культура);
   - filtered by CEFR level (A2, B1, B2, C1; A1 when we have texts for it).
2. **A reader** that feels like a book, not an app page:
   - a warm background, a literary serif, comfortable measure and spacing;
   - no clutter inside the text.
3. **Tap a word** to see, in a small sheet at the bottom:
   - its dictionary form (and the form in the text when they differ, e.g. *went → go*);
   - part of speech and pronunciation;
   - the Russian translation;
   - a short simple-English explanation;
   - the sentence it came from.
4. **«Добавить в слова»**: the learner decides what to keep. Tapping only looks; nothing is saved
   by accident.
5. **The article's basket**:
   - the words saved from this article, with translation and sentence, a count, and removing;
   - no duplicates of one dictionary form.
6. **«Учить N слов»**: the basket becomes flashcards in the **existing** spaced-repetition
   system. There is no second flashcard system.
7. **Finishing**: «Готово» at the end marks the article read; the library shows ✓ (and a thin bar
   for an article started).

## How it feels
- **The article first.** Learning controls live in the top bar (which hides while reading) and in
  sheets that open on demand. There's no dashboard above or below the text.
- **Words look like text.** No underlines or link colours. A word saved from this article gets a
  faint warm highlight, so the text never turns into a colourful mess.
- **Comfort settings («Aa»):** text size (16–24 px, default 19) and three themes: **Бумага**
  (warm white), **Сепия**, **Ночь**. The choice is kept on the device.
- **Every article names its source and licence** at the end («Источник: VOA Learning English,
  public domain»).

## The basket is a deck (decision)
- **When it's created:** the first «Добавить» in an article creates **a deck named after the
  article**. Each saved word becomes a card in it at once: offline-first, synced to the learner's
  other devices, with the same scheduling as every deck.
- **What the basket shows:** that deck. **«Учить N слов»** starts a lesson in it.
- **Course words:** a word that is also a course word (same spelling and part of speech) is
  **linked** to the course card, not copied, so its progress is kept.
- **Source sentence:** the card's example is the sentence the word was read in.

## Who sees it
Tester accounts only, listed on the server (`READING_TESTERS`, the same pattern as
`CONTENT_EDITORS`). For them a fourth tab, **«Чтение»**, appears in the bottom bar, on the
website and in the Android app alike.

## Content
- **Source:** small and curated, about 8 articles to start, from **free-licensed** texts, each
  credited:
  - **VOA Learning English** (US government, public domain) for A2–B1;
  - **Simple English Wikipedia** (CC BY-SA: credited; our adapted versions keep CC BY-SA) and
    **NASA** (public domain) for B1–B2;
  - 1–2 **original** articles where the sources leave a gap.
- **Excluded:** texts from BBC, National Geographic or other copyrighted publications, unless we
  have a licence.
- **Translations:** Russian only for now (like the course). Every word of an article has its
  meaning prepared in advance and reviewed. There's no AI call when a word is tapped.

## Deliberately not built (yet)
- **Publishing:** a public content marketplace, user-generated publishing, a CMS.
- **People:** social features (sharing, comments, reading with friends), teacher marketplaces.
- **Courses:** IELTS courses, children's experiences, AI-generated curricula, recommendation
  algorithms.
- **Speaking:** speech recognition or speaking assessment (*Express* comes later).
- **Sync:** reading progress synced between devices. Progress stays on the device in this
  experiment; saved words *are* synced, because they are cards.
- **Languages:** translations into ky/kk/uz/tg (see the languages doc for how to add them).
- **Selection:** multi-word selection (phrases). One tap = one word; phrases come in v2.

## Success
See [the hypothesis](../experiments/reading-mode/hypothesis.md).
