# 0029 — Decks from photos, read in the browser; 1 to 50 words a draft

**Status:** Accepted. Refines ADR 0018 (drafting a deck from a teacher's text).

## Context
Teachers have lesson material on paper: a textbook page, a worksheet. Typing it in is the slow
part of making a deck. The owner asked for photos as in ChatGPT or Claude: several images at once,
the text read from them, then the words drafted. DeepSeek, the drafting model (ADR 0018), cannot
read images. The owner also wanted to choose how many words to draft, up to 50 (it was 5–20).

## Decision
- **Photos are read in the browser** with Tesseract OCR (`tesseract.js`, English model): free,
  no new account, and the photos never leave the device. Only the text read from them is sent,
  exactly as typed text is. The engine and its model (about 7 MB) are served by this app under
  `/ocr/` (copied from pinned npm packages at build time, not committed), not a public CDN, so
  school networks that block CDNs still work; they load on first use and are cached by the
  browser. A failed download shows an error at once rather than waiting forever.
- **Screenshots can be dragged onto the panel or pasted into the text box** (Ctrl+V, ⌘V on a Mac), as well as picked with «Добавить фото»; a file dropped beside the panel is ignored rather than opened by the browser.
- **The text lands in the text box** for the teacher to check and fix, then «Подобрать N слов»
  drafts as before. Words split across lines are joined; a photo with almost no text is skipped,
  with a note.
- **Limits:** up to 4 photos per draft and 8 per deck in all. Photos count only once a draft
  succeeds. The server checks the declared count (`photos`), so this is a fair-use limit, not a
  security one: OCR runs on the device. The daily drafts limit still caps the cost.
- **Words per draft:** quick choices 5 · 10 · 20 · 30 · 50, or any number from 1 to 50. The
  drafting timeout is 180 s; 50 cards fit in the existing token limit.

## Consequences
- Printed pages and screenshots read well (a slightly rotated textbook page read word-perfect in
  about 2 s on first try). Handwriting and blurred or skewed photos read poorly; the teacher sees
  and fixes the text first. A paid vision model would read those, at a cost and with photos sent
  to a third party; it was not chosen.
- Migration: `decks.photos_used`.
