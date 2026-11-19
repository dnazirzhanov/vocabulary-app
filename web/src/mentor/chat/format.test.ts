import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grouped, groupOf, hhmm, messageTime, titleOf } from './format.ts';

test('minutes read as a clock, wrapping past midnight', () => {
  assert.equal(hhmm(0), '00:00');
  assert.equal(hhmm(19 * 60 + 5), '19:05');
  assert.equal(hhmm(1440), '00:00');
});

test('a message from today shows its time; from another day, its date too', () => {
  const now = new Date(2026, 10, 20, 21, 0);
  assert.equal(messageTime(new Date(2026, 10, 20, 8, 15), now, 'ru'), '08:15');
  assert.match(messageTime(new Date(2026, 10, 18, 8, 15), now, 'ru'), /^18 нояб\.?, 08:15$/);
});

test('chats fall into today, yesterday, this week and earlier by calendar day', () => {
  const now = new Date(2026, 10, 20, 0, 30); // just after midnight
  assert.equal(groupOf(new Date(2026, 10, 20, 0, 5), now), 'today');
  assert.equal(groupOf(new Date(2026, 10, 19, 23, 50), now), 'yesterday'); // 40 minutes ago
  assert.equal(groupOf(new Date(2026, 10, 15, 12, 0), now), 'week');
  assert.equal(groupOf(new Date(2026, 10, 1, 12, 0), now), 'earlier');
});

test('groups come in order, newest first inside, empty ones left out', () => {
  const now = new Date(2026, 10, 20, 12, 0);
  const chats = [
    { id: 'a', updated_at: new Date(2026, 10, 1).toISOString() },
    { id: 'b', updated_at: new Date(2026, 10, 20, 9).toISOString() },
    { id: 'c', updated_at: new Date(2026, 10, 20, 11).toISOString() },
  ];
  assert.deepEqual(
    grouped(chats, now).map(([g, list]) => [g, list.map((c) => c.id)]),
    [
      ['today', ['c', 'b']],
      ['earlier', ['a']],
    ],
  );
});

test('a working title is the first question, cut at a word', () => {
  assert.equal(titleOf('  Как   учить слова? '), 'Как учить слова?');
  const long = titleOf('Я хочу сдать IELTS на 6.5 к июню, но у меня очень мало свободного времени');
  assert.ok(long.length <= 61 && long.endsWith('…') && !long.includes('свобод'));
});
