# 0075 — A mentor that remembers

**Status:** Accepted (the owner's request, 20 November 2026: «make the mentor not forget who the user is, what goals
they have, and what they want»).

## Decision
Considered: a longer chat history, automatic summaries, a vector store of every message, fine-tuning, a structured
learner profile, an event timeline, memory as tools, and a page where the learner sees and edits it all. Chosen: the
last four together, plus short chat summaries. At this scale a typed profile is more accurate, cheaper and auditable
than embeddings, and it can be shown to the learner, which matters with minors among them.

- **Facts** (`learner_facts`): why they learn, likes, dislikes, limits on their time, when they have energy, their own
  words, other. The mentor proposes one with `remember` as a «Запомнить?» chip; it is kept only on the tap. The
  learner can write, change (the old one is kept as superseded) or forget (deleted) any fact. At most 60.
- **Timeline** (`mentor_timeline`): the coach writes what happens as it happens — goal set, study time promised,
  today changed or restored, pause, adjustment accepted or declined.
- **Chat summaries:** a chat of six messages or more gets a two-sentence summary after the answer has streamed, and
  again every six more. Without a model, its title stands in.
- **In the prompt:** a «what you know about this learner» block (facts, the last six events, summaries of the last
  three other chats); `recall` searches facts, events and chats by their words. The rules tell the mentor not to
  remember passing moods or anything private a family or teacher should not see.
- **«Что наставник знает обо мне»** (from the home and the chat's sidebar) shows all of it.
- **Evals** (`backend/evals/`): twelve scripted conversations scored by tools called, local time stated, at most one
  card per activity, language, and numbers no tool gave. CI checks the scoring; `uv run python -m evals.run --live`
  plays them against the real model inside a transaction that is rolled back.
