# 0018 — Drafting a deck from a teacher's text

**Status:** Accepted. Builds on ADR 0017.

## Context

Writing a deck by hand (ADR 0017) is still the slow part of a teacher's work. They already have
the material: the text of tomorrow's lesson. Choosing the words worth learning from it and writing
a meaning that fits that text is a language task a model does well; checking lengths, duplicates
and spelling rules is not, and is done in code.

## Decision

- **Paste, draft, review.** In the deck editor the teacher pastes a text (20–20,000 characters),
  picks how many words (5, 10, 15 or 20) and the learners' level (A1–C1). The drafted cards are
  added to the deck for review; nothing reaches students until the teacher gives the deck to the
  group. Pasting again adds more, never repeating a word the deck has.
- **One model call, a JSON answer.** DeepSeek (the owner's choice: they hold credits there;
  OpenAI-compatible API, `deepseek-flash` by default, `DEEPSEEK_MODEL` switches to
  `deepseek-v4-pro`) reads the text and returns cards in JSON mode. The prompt gives the shape with
  an example, as DeepSeek's JSON mode needs: the dictionary form (managed → manage, carried out →
  carry out), part of speech, a short Russian meaning that fits this text, an example at the
  learners' level (the source sentence when it is short and clear), its Russian translation, and
  the source sentence. The answer is validated against that shape in code; an empty answer, which
  DeepSeek's JSON mode may now and then return, is asked again once. Errors name what happened:
  wrong key, busy, out of credit, no answer. The text is treated as data: the prompt says to
  ignore instructions inside it.
- **Checked in code, never dropped in silence.** A card whose headword can't be spelled, that
  repeats a word or doesn't fit the columns is not saved and is listed with the reason. A saved
  card can carry flags for the teacher: the meaning isn't Russian, the example lacks the word, the
  example is long. Flags are computed from the word itself, so they apply to typed words too and
  disappear once fixed. Course words are linked as in ADR 0017.
- **The text is not kept.** It is read once for the request; each card keeps only its own source
  sentence, shown to the teacher as «Из текста». Texts are never logged.
- **Providers behind one interface.** `deepseek` needs `DEEPSEEK_API_KEY`; `demo` makes placeholder
  cards from the text's own words, labelled as such, so development and tests need no service.
  `auto` (the default) uses DeepSeek with a key, the demo without one outside production, and no
  generation in production without a key. Tests always use the demo.
- **Cost.** 20 drafts per teacher per day (in-process limit, one instance).
- **Synchronous for now.** The request waits for the model (up to about a minute; the client
  allows two). A background job with stages, as first planned, waits until the wait proves a
  problem in the pilot.

## Consequences

- The teacher's text is sent to DeepSeek, a service in China. Its data-handling terms and the
  data law for schools must be checked by the owner before real lesson material is used (see
  product requirements, Privacy).
- Quality is not measured yet: we don't record which drafted cards a teacher changed or removed.
- One call does choosing and writing together; if choices are poor, splitting it into a choosing
  call and a writing call is the next step.
