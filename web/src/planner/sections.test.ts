import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item, Task } from './api.ts';
import { dayView, inbox, openCount, upcoming } from './sections.ts';

const T = '2026-11-23';
let n = 0;
const item = (title: string, on: string | null, extra: Partial<Task> = {}, rest: Partial<Item> = {}): Item => ({
  task: {
    id: `t${(n += 1)}`,
    title,
    notes: '',
    due_on: on,
    start_minute: null,
    repeat_mask: 0,
    repeat_until: null,
    priority: 0,
    kind: 'task',
    ...extra,
  },
  on,
  state: null,
  overdue: false,
  ...rest,
});

test('a day: overdue on top, timed by time, then priority; done apart; skipped hidden', () => {
  const items = [
    item('Позже', T, { start_minute: 21 * 60 }),
    item('Важное', T, { priority: 3 }),
    item('Утро', T, { start_minute: 8 * 60 }),
    item('Обычное', T),
    item('Сделано', T, {}, { state: 'done' }),
    item('Пропущено', T, {}, { state: 'skipped' }),
    item('Старое', '2026-11-20', {}, { overdue: true }),
  ];
  const view = dayView(items, T, T);
  assert.deepEqual(
    view.overdue.map((i) => i.task.title),
    ['Старое'],
  );
  assert.deepEqual(
    view.open.map((i) => i.task.title),
    ['Утро', 'Позже', 'Важное', 'Обычное'],
  );
  assert.deepEqual(
    view.done.map((i) => i.task.title),
    ['Сделано'],
  );
  // Overdue shows only on today.
  assert.deepEqual(dayView(items, '2026-11-24', T).overdue, []);
});

test('inbox, upcoming and the dots', () => {
  const items = [
    item('Без даты', null),
    item('Завтра', '2026-11-24'),
    item('Сегодня', T),
    item('Сегодня, сделано', T, {}, { state: 'done' }),
  ];
  assert.deepEqual(
    inbox(items).open.map((i) => i.task.title),
    ['Без даты'],
  );
  assert.deepEqual(
    upcoming(items, T).map((d) => [d.day, d.items.map((i) => i.task.title)]),
    [
      [T, ['Сегодня']],
      ['2026-11-24', ['Завтра']],
    ],
  );
  assert.equal(openCount(items, T), 1);
});
