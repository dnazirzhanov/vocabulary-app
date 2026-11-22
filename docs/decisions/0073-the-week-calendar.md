# 0073 — The week the mentor plans around: exact, useful, easy to fill

**Status:** Accepted (the owner's direction, 19–20 November 2026).

## Context
The owner: the calendar «looks terrible, inaccurate. No one would like to use it», and filling a schedule is usually
painful: help people set it up creatively, maybe through the chat. The old view was a 7-column grid: at 360 px each
day was about 45 px wide, overlapping blocks covered each other, short blocks were stretched, there were no dates, and
nothing in it related to studying.

## Decision
- **Shape** (chosen from a 7-column grid, a month grid, an agenda list, a 3-day grid, a heat-map week, and a week strip
  with a day timeline): on phones, a week strip of real dates (today marked, a dot on busy days, weeks back and forth)
  above one day's timeline; from 1024 px, the whole week side by side.
- **Exact** (`schedule/layout.ts`): overlapping blocks share the width in lanes; heights are true to the minute; the
  visible hours are 07–22 and grow to fit earlier or later blocks; the now line is in the learner's own time.
- **Useful:** today's study tasks sit where the coach placed them (`mentor/slots.ts`) as one dashed block with
  «Начать»; the promised study time shows on its days; free stretches of an hour or more are named.
- **Easy to fill:** an empty week asks «Расскажите о своей неделе» in a free text box that goes to the mentor's chat,
  which proposes the blocks for a tap to add (ADR 0072); or a template («Школьник», «Студент», «Работаю 9–18»)
  previewed before it is added; then «+», tap a block to change it, drag to move it, drag its edge to resize it, by
  quarter hours.

## Consequences
- Blocks repeat weekly (the data has weekdays, not dates), so the strip's other weeks show the same pattern; only
  today carries study blocks.
- Dragging moves a block on every day it repeats on.
