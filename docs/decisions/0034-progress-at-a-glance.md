# 0034 — «Прогресс» at a glance, in plain words

**Status:** Accepted. Supersedes the layout of ADR 0033 (its per-deck goal stays); refines ADR
0022's wording.

## Context

Even after ADR 0033 the owner found «Прогресс» hard to read: learners couldn't tell instantly how
they were doing.

- It used three terms that need explaining: «встречено», «выучено», «надёжно». A fresh deck read
  «выучено 0» after 11 words studied.
- Nothing at the top answered «how am I doing, what changed».
- The settings sat inside the page.

## Decision

- **A summary card first:**
  - «Вы знаете слов: 21» (plural whatever the number, and correct Russian);
  - «+12 за эту неделю · ещё 47 учите» (words first recalled since Monday, a new
    `learned_this_week`);
  - the week's seven days with «5 из 6 дней на этой неделе · ещё 1 день до цели».

  Before anything is known: «Вы учите слов: N» and a line on how a word becomes known.

- **Plain stages instead of terms:**
  - «знаю»: recalled a day or more after meeting it, the old «выучено»;
  - «учу»: met, still settling;
  - «впереди»: not met yet.

  «надёжно» leaves the page.

- **Each deck is a card:**
  - the title with «68 / 100»;
  - one two-tone bar (знаю inside met);
  - «знаю 21 · учу 47 · впереди 32», with zero parts left out.

  The owner later removed the goal line from the cards («Сегодня: 3 новых», «≈ 7 дней до конца»,
  the teacher's date): today's words and the deadline are on the deck's own page.

- **The heatmap** stays as it was, under its own heading.
- **A deck's own page uses the same words:** «68 из 100 слов», the same two-tone bar, and «знаю 21
  · учу 47 · впереди 32» instead of «помню хорошо / встречено» (deck stats gain `learned`).
- **Settings move behind ⚙** in the page's header, into a «Настройки» window: sounds, reminders,
  signing out, deleting progress.

## Consequences

- The page reads top to bottom as summary → decks → calendar; no section needs a legend.
- Tests open the settings through ⚙ (`openSettings` in the e2e helpers).
