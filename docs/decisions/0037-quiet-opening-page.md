# 0037 — A quieter opening page

**Status:** Accepted. Refines ADR 0021 («Мои колоды» is home).

## Context

The opening page repeated itself. Under «Мои колоды» it explained itself («Свои колоды и колоды из
ваших групп. Колода учится, когда вы её открываете.»), labelled the decks the learner made
(«Созданные мной») though they sit right under «Создать колоду», and gave every deck card a
«Сегодня: 4 повт.» line that the deck's own page says better.

## Decision

- The intro sentence goes.
- The «Созданные мной» heading is no longer drawn. It stays for screen readers, which name the
  section by it; «Из моих групп» keeps its visible heading, since it separates decks from others.
- A deck's card keeps its name, size and «встречено N», and a teacher's deadline when there is
  one. Today's counts («Сегодня: …») are on the deck's page, as one sentence (ADR 0035).

## Consequences

- The library endpoint still sends each deck's `new_today`, `learning_count` and `review_count`;
  the page no longer reads them.
