# 0088 — Done tasks stay in place, and ticking one is celebrated

**Status:** Accepted (the owner, 25 November 2026: «we should show the completed tasks too, but they are just crossed …
how do we make people feel dopamine when they complete the tasks? … a visual animation … with a soundtrack»).
Amends 0084.

## Decision
- **Done tasks stay where they are**, crossed out and muted, in the day's order (by time, then priority). The
  folded «Выполнено · N» is gone: the day reads as a whole, and what was done stays in view.
- **Each tick is celebrated:**
  - the circle pops and fills, eight sparks fly from it, and a line strikes across the title;
  - the row glows green for a moment;
  - a short sound plays, a soft «pop» then a bright rising pair (G5 → C6), under half a second, synthesised like the
    app's other reward sounds (ADR 0024): no files, the same everywhere;
  - a light vibration where the phone has one.
- **The day's last task is celebrated more:** the lesson's confetti and its finish chord. «Всё на сегодня сделано» shows
  only when nothing is left, the app's study list (0087) included.
- **What still holds:** the sound follows the app's sound setting; with reduced motion there is no animation, only the
  sound and the crossed-out task; «Отменить» stays for 4 s.
