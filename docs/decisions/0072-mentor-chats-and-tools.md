# 0072 — The mentor's chats: several conversations, tools that act, and the right time

**Status:** Accepted (the owner's decisions, 19–20 November 2026).

## Context
The owner asked for a T3 Chat-style mentor chat with several conversations; for tool calls («what should I do now?»
→ the mentor checks → a suggestion with «Начать сейчас»); for help filling in the schedule through the chat; and
reported that the mentor said the wrong time.

## Decision
- **Chats** (`mentor_conversations`; `mentor_messages.conversation_id`): each titled from its first question,
  renameable, deletable, a learner's own alone. The existing messages became each learner's first chat. The app
  before chats keeps working: without a chat named it continues the latest one.
- **Tools** (OpenAI-style function calling on DeepSeek, at most 3 rounds, streamed): `what_now`,
  `suggest_activity`, `get_week_plan`, `propose_goal`, `propose_schedule`, `propose_study_times`, run on the coach's
  rules (ADR 0071). Each streams a step («running» then «done» with a card) and is kept with the answer
  (`mentor_messages.parts`), so a reopened chat shows its cards again.
- **Nothing is saved by a tool.** A goal, a schedule or a study time becomes real only when the learner taps its
  card. Activities point only at today's tasks as the app sent them (now with their deck or article) or at the
  Writing and Speaking sections; with nothing of a kind today, the tool says so instead of inventing one. Proposed
  events are validated (title, kind, days 0–6, `HH:MM` times, start before end) and the rest dropped.
- **The right time:** the prompt now opens with the learner's local day, date, time and zone, and says that times
  in earlier messages are out of date; the learner's earlier messages reach the model marked with when they were
  sent («[Thu 08:15]»). Before, the time was one line among forty and old answers («сейчас утро») read as current.
- **Without a model** (development, e2e) a question plainly asking for a tool gets it, by its words, so the whole
  flow can be tested.
- A chat named in a request is checked before the stream starts, so someone else's chat is a plain 404.
