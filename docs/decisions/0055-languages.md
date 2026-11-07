# 0055 — Learn English in your own language

**Status:** Accepted (the owner's request, 6 November 2026).

## Context
The app was Russian-only: about 900 strings in 65 files, Russian grammar in code, and Russian in card data, AI prompts and notifications. The owner wants people who know only Uzbek, Tajik, Kazakh or Kyrgyz to be able to learn English before release.

## Decision
- **People learn English only.** Other languages to learn are out for now.
- **Two settings, never one:** the translation language (on cards: Russian, Uzbek, Tajik, Kazakh, Kyrgyz) and the app language (those five and English). The app language starts as the translation language chosen, and each can be changed in ⚙.
- **Uzbek in Latin script** (`oʻ`, `gʻ`).
- **The course stays Russian-only** and is hidden for everyone else.
- **A deck has one translation language,** chosen by its author; a group's students see it whatever they chose.
- **Released without native review,** by the owner's choice, with a way to report bad wording.

## How text works
- **No library.** `web/src/i18n/ru.ts` holds every line; the other languages are typed against it, so a missing or extra line doesn't compile. Code reads `t.tryAgain`, `t.wordsCount(3)`.
- **A sentence with something in it is one function,** so each language can order it and apply its own grammar. Sentences are never glued from pieces. `{0}` marks markup, for `rich`.
- **A Russian string outside `src/i18n` fails lint,** so a new screen can't forget.

## Consequences
- Adding a line means adding it in every language, or the build fails. That is the point.
