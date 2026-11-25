# 0091 — Tap a word in a Writing or Speaking question for its meaning

**Status:** Accepted (the owner, 25 November 2026: «when users don't know any word in the question prompt of a ielts
writing question … they should be able to just click, like it is handled in the reading section … not just for
writing questions but also for speaking questions»).

## Decision
- **Every word of a question can be tapped:** the Writing question (writing screen, feedback) and the Speaking
  question and its sentence to read (question page, exercise).
  - The lesson's word card opens under the word: the meaning in the learner's card language, its dictionary form
    and a short explanation when there is one, and «listen».
  - The word is highlighted while its card is open; Escape, a tap elsewhere or scrolling closes it.
  - Words are buttons, so the keyboard reaches them; the sentence still reads as one heading or paragraph.
- **Meanings as Reading makes them:**
  - The same model, prompt and rules as a learner's own text (`readings.write_meanings`): each word as used in this
    question, with the course glossary's Russian for any word the model leaves out.
  - Made on the first tap, for that question and card language, and kept (`prompt_glossaries`), so every later tap,
    by anyone, is instant and costs nothing.
  - A question reworded is glossed again.
- **Only the app's own questions:** `GET /prompt-glossary/{writing|speaking}/{question_id}` takes a question's id,
  never free text, so it is no free translator. A model failure is said (the card keeps «Перевод скоро появится»),
  not kept, and a later tap tries again.
