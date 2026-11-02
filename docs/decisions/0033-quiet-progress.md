# 0033 — «Прогресс»: progress and a goal per deck, nothing more

**Status:** Accepted. Refines ADR 0022 (progress by deck) and applies ADR 0032's rule to «Прогресс».

## Context
The owner asked for «Прогресс» to show only what conveys progress and sets goals, deck by deck,
keeping the heatmap.
- Each deck row had a source line, a percentage (0 % for every new deck), a three-tone bar with a
  legend, and two count lines. One read «сегодня 8 из 5 новых» when extra words were taken.
- The top had three sub-lines, spelling included.
- The calendar ended with a footnote.

## Decision
- **The top:** words learned, and «из них надёжно — N». The «встречено» total moves into the
  decks; the spelling line goes (the spelling window on a deck page shows the hard words).
- **Each deck, in two lines under its title and bar:**
  - how far along: «выучено 21 · встречено 68 из 100 слов». The bar has two tones, met and
    learned, named by that line, so no legend is needed.
  - its goal: «сегодня 0 из 5 новых» (in strong text while today's words are still to do) or
    «на сегодня ✓», then the finish. The finish is the teacher's «к 2 ноября», or «осталось 32
    слова ≈ 7 дней» at the deck's own pace (a new `pace` field on each row).
- **Only decks I've started** are listed: studied in that deck itself (a lesson or hard-words
  practice with an answer). A course word met in another deck doesn't start its level. The rest
  wait in «Мои колоды» (added after review).
- **The course levels** share one pace, so only the level the learner is on carries today's goal;
  a later, locked level just says what is left.
- **Removed:** the percentage and the source line on each deck, the legend, and the calendar's
  footnote.
- **Kept as they are:** the week against the promise and the heatmap, as the owner asked.

## Consequences
The rule for when a day counts is no longer printed on the page. The week's circles say «день
засчитан» to screen readers, and the rule is in ADR 0027.
