# 0024 — Celebrations and reward sounds

**Status:** Accepted.

## Context

Finishing a lesson or a round of spelling ended on a still screen. The owner wants the finish to
feel rewarding, like Khan Academy's, and spelling — the effortful part — rewarded word by word.

## Decision

- **Every finish screen celebrates** (`ui/Celebration.tsx`): confetti falls past the screen for
  about three seconds and a short chord plays (a rising C-major arpeggio, then the chord with a
  little sparkle, under two seconds). The badge pops, then the title, the lead and each word rise
  in. The component is meant for future rewards too. Confetti is decoration: hidden from screen
  readers, never catching a tap, absent under reduced motion.
- **A spelled word right on the first try rings a chime** (two quick rising notes). A rebuild after
  the answer was shown stays quiet, and so do flashcards: rating a card is a self-check, not an
  achievement.
- **Sounds are synthesised in the browser** (Web Audio API, `lib/sounds.ts`): no files to load or
  license. They follow a tap, so browsers allow them.
- **Sounds can be turned off**: «Звуки» under «Аккаунт» on «Прогресс», remembered per browser.

## Consequences

- Classrooms can mute the app per device; the confetti still shows.
- The browser test counts the notes the page starts, so silence for flashcards is tested.
