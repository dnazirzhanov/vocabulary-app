# 0077 — The mentor composes the interface

**Status:** Accepted (the owner's request, 20 November 2026: «how to make 100x use of Gen UI»).

## Decision
Considered: the model writing HTML or JSX (unsafe, off-brand, untestable), a JSON layout language the app interprets
(flexible but the model would invent facts and layouts), and a typed catalogue of components. Chosen: the catalogue.

- **One tool, `show(component, …)`.** The model chooses the component and, for a question, its words. The server
  fills in every fact (times, blocks, words, counts) and validates the card against a pydantic discriminated union
  (`app/schemas/gen_ui.py`) before sending it; anything else is refused with a reason the model can read. The app
  draws each card in its own design (`web/src/mentor/chat/GenCards.tsx`).
- **The catalogue:**
  - `day`: today on one line (07:00–23:00) and as a list: today's real blocks, today's tasks placed in the free time
    by the same rule as the home, the kind of day, and now;
  - `words`: up to five words due for review to recall (tap to check; nothing graded), then «Повторить N слов»
    starts the real review through the usual lesson path, so nothing offline changes;
  - `day_check`: what kind of day it is (ADR 0076), applied on tap; the home reloads its plan;
  - `choice`: one question with two to four answers; a tap sends the answer as the learner's message;
  - `celebrate`: only milestones that are true (weeks in a row, days studied this week, words known); none, no card.
- **Streaming:** while a component is being made, its shape (a skeleton) stands in its place.
- **Today's plan beside the chat** from 1280 px, each task startable.
- Every write still needs the learner's tap; the cards from ADR 0072–0075 are unchanged.

## Not now
Practice graded inside the chat (flashcards, spelling, speaking): it would need the offline study path in a second
place; the warm-up plus a start button gives most of the value without it. Dragging tasks on the chat's timeline.
