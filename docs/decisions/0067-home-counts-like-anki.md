# 0067 — Home shows today's numbers on every deck, as Anki does

**Status:** Accepted (the owner's request, 12 November 2026). Supersedes part of ADR 0037.

## Context
Home opened with a large «Продолжить» card naming one deck to study. The owner asked to remove it and
instead show on every deck, as Anki does, in different colours, how many new words are to be
learned today and how many to repeat. ADR 0037 had moved those numbers to the deck's page.

## Decision
- **The «Продолжить» card goes.** Every deck is one tap from home, and its page has the lesson
  button.
- **Every deck row shows three numbers**, in the course list's colours (`--color-count-*`):
  - **Нов.** (blue): new words in the deck's pace for today;
  - **Изуч.** (orange): cards in learning steps, due now;
  - **Повт.** (green): reviews due now.
- **How the numbers read:**
  - a zero steps back in grey;
  - the short column names sit once above each list;
  - each number says its full name to a screen reader («3 новых»).
- **The «Из чтения» row** shows the sum of its decks' numbers, as Anki's parent decks do.
- **Small phones (under 360 px)** get tighter rows, so a deck's name keeps its room.

## Consequences
- The numbers come from the library endpoint, which already sent them (ADR 0037 kept them).
- A deck made on this device and not yet on the server shows zeros until it arrives.
