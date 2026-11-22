import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freeGaps, hourRange, placeLanes, snap, weekOf } from './layout.ts';

const b = (id: string, start: number, end: number) => ({ id, start, end });

test('overlapping blocks get lanes side by side; apart ones take the full width', () => {
  const placed = placeLanes([b('school', 480, 840), b('club', 780, 900), b('gym', 1080, 1140), b('lunch', 720, 780)]);
  const by = Object.fromEntries(placed.map((p) => [p.item.id, [p.lane, p.lanes]]));
  // School overlaps lunch and the club; lunch and the club touch but don't overlap.
  assert.deepEqual(by.school, [0, 2]);
  assert.deepEqual(by.lunch, [1, 2]);
  assert.deepEqual(by.club, [1, 2]);
  assert.deepEqual(by.gym, [0, 1]);
});

test('three at once need three lanes', () => {
  const placed = placeLanes([b('a', 600, 700), b('b', 610, 650), b('c', 620, 690)]);
  assert.deepEqual(
    placed.map((p) => [p.item.id, p.lane, p.lanes]),
    [
      ['a', 0, 3],
      ['b', 1, 3],
      ['c', 2, 3],
    ],
  );
});

test('the day shows 07–22, widened to fit early and late blocks', () => {
  assert.deepEqual(hourRange([]), { first: 7, last: 22 });
  assert.deepEqual(
    hourRange([
      { start: 5 * 60 + 30, end: 6 * 60 },
      { start: 22 * 60, end: 23 * 60 + 15 },
    ]),
    {
      first: 5,
      last: 24,
    },
  );
});

test('free gaps between blocks, the short ones left out', () => {
  assert.deepEqual(
    freeGaps(
      [
        { start: 480, end: 840 },
        { start: 855, end: 900 },
      ],
      7,
      22,
    ),
    [
      { start: 420, end: 480 },
      { start: 900, end: 1320 },
    ],
  );
});

test('times snap to the quarter hour; a week runs Monday to Sunday', () => {
  assert.equal(snap(487), 480);
  assert.equal(snap(488), 495);
  const week = weekOf(new Date(2026, 10, 19)); // a Thursday
  assert.equal(week[0].getDate(), 16);
  assert.equal(week[6].getDate(), 22);
});
