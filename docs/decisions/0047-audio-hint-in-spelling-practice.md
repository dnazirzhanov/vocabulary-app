# 0047 — An audio hint in individual spelling practice

**Status:** Accepted (the owner's request, 5 November 2026). Amends ADR 0016: a spelling card's data now holds its
word, for this.

## Context
A spelling card shows a word's Russian meaning, and one hint gives a letter (ADR 0016). The owner asked for a second
hint: the English pronunciation, the same one the flashcards play. It reveals something, but spelling what you hear is
still hard, and it lets students practise for a group's test at home in another way. A group's test stays without any
hints (ADR 0046).

## Decision
- **It reads as a hint, because the point is to spell without it.** The owner tried a speaker beside the meaning, like a
  flashcard's, and moved it: there it looks like part of the question and invites a tap first. It now sits below the letters in
  one quiet row with the letter hint: «Подсказки: Буква · Звук».
- **«Звук» plays the word's recording,** or the device's voice where there is none, as flashcards do. Decks people write
  themselves have no recordings.
- **As often as asked, and nothing plays by itself.** Like the letter hint, it goes once the word is checked.
- **It isn't used up.** Each card still has its one letter, whether or not the word was heard.
- **A word heard counts as a miss on the ladder, like a word hinted (ADR 0026).** The owner's decision: students should spell
  without it, and a group's test has no sound, so «умеет писать» has to mean they managed alone. They are still told «Верно»;
  the word just comes back the next day. The device says whether it was heard, kept across a reload. That is safe to trust
  here, since only the student's own practice depends on it.
- **Only in individual practice.** Cards of a group's test and its «Тренировка» don't carry the word at all, and a test covers that.

**The card's data carries the word,** so ADR 0016's "the word stays on the server until answered" no longer holds for these
cards. The device's voice needs the text, and phones play sound only if it starts right on the tap, so fetching the word on the
press would risk silence on iPhones. Nothing shows it on screen. Someone reading the network traffic could find it, which only
cheats their own private practice.

## Consequences
- A student who listens every time sees those words stay in «Трудные». That is accurate, and could feel discouraging; worth
  watching with real students.
- The word's recording isn't fetched until it is asked for.
