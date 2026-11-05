# 0047 — An audio hint in individual spelling practice

**Status:** Accepted (the owner's request, 5 November 2026). Amends ADR 0016: a spelling card's data now holds its
word, for this.

## Context
A spelling card shows a word's Russian meaning, and one hint gives a letter (ADR 0016). The owner asked for a second
hint: the English pronunciation, the same one the flashcards play. It reveals something, but spelling what you hear is
still hard, and it lets students practise for a group's test at home in another way. A group's test stays without any
hints (ADR 0046).

## Decision
- **«Послушать слово»: the flashcard's speaker button, beside the meaning.** It plays the word's recording, or the device's
  voice where there is none, as flashcards do. Decks people write themselves have no recordings.
- **As often as asked, and nothing plays by itself.** It also works after answering, when hearing the word costs nothing.
- **It isn't the one letter hint.** Each card still has its letter hint, whether or not the word was heard.
- **It doesn't count against the learner.** A letter hint makes a word a miss on the ladder (ADR 0026), because it gives part
  of the spelling. Hearing a word gives none of its letters, so a right answer after listening counts as right.
- **Only in individual practice.** Cards of a group's test and its «Тренировка» don't carry the word at all, and a test covers that.

**The card's data carries the word,** so ADR 0016's "the word stays on the server until answered" no longer holds for these
cards. The device's voice needs the text, and phones play sound only if it starts right on the tap, so fetching the word on the
press would risk silence on iPhones. Nothing shows it on screen. Someone reading the network traffic could find it, which only
cheats their own private practice.

## Consequences
- **«умеет писать» can now be reached with listening.** A student can climb the ladder hearing every word, then find a test
  harder without it. If that shows in practice, the fix is one rule: count a word heard like a word hinted, which needs the server
  told when it was heard.
- The word's recording isn't fetched until it is asked for.
