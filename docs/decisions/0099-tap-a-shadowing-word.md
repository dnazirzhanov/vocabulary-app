# 0099 — Tap a word of a shadowing sentence for its meaning

**Status:** Accepted (the owner, 26 November 2026: «make the current text displayed translatable, meaning that
when the user presses on the word, we have to show the translation, just like we are doing it in other sections
like reading section»).

## Decision
- **Tap for the meaning:** in sentence-by-sentence shadowing (ADR 0098), each word of the sentence on screen is
  a button. A tap shows its meaning in the card language, in the lesson's word card with «listen», as in Reading
  and as Writing and Speaking questions do (ADR 0091, `TappableText`). The words still light up as they are said.
- **One sentence at a time:**
  - Meanings are made per sentence (`prompt-glossary/shadowing/<exercise id>.<index>`) on the first tap, by the
    same model and rules as a question's.
  - They are then kept for everyone who may open the exercise, and remade if its owner changes the sentence.
  - A transcript may run ten minutes, far too long to gloss while the learner waits. A sentence takes a moment
    once, and is instant after that.
- **Only what the learner may open is glossed:** their own exercises, curated ones, and those their groups' tasks
  link. Sentences are bounded: at most 300 characters, 200 to an exercise, 50 exercises to a learner. So this is
  not a translator for any text.

## Consequences
- One small model call per sentence and card language, the first time anyone taps a word in it.
- With no model, or when the model fails, the card says the translation will come, and a later tap tries again,
  as for questions.
