import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repeatStart } from './dates.ts';

// Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
const WED = 4;
const SAT = 32;

test('a repeat starts on the first of its days from the date chosen', () => {
  // Thursday 26 November 2026.
  assert.equal(repeatStart('2026-11-26', WED | SAT), '2026-11-28'); // this Saturday
  assert.equal(repeatStart('2026-11-26', WED), '2026-12-02');
  assert.equal(repeatStart('2026-11-28', WED | SAT), '2026-11-28'); // the day itself counts
  assert.equal(repeatStart('2026-11-26', 0), '2026-11-26'); // no repeat: the date as chosen
});

test('tapping Wednesday then Saturday on a Thursday starts this Saturday, not next Wednesday', () => {
  // The picker counts each tap from the chosen date, not from where the last tap moved it.
  const chosen = '2026-11-26';
  const afterWednesday = repeatStart(chosen, WED);
  assert.equal(afterWednesday, '2026-12-02');
  assert.equal(repeatStart(chosen, WED | SAT), '2026-11-28');
  // What the picker did before: count on from the moved date, which skipped this Saturday.
  assert.notEqual(repeatStart(afterWednesday, WED | SAT), repeatStart(chosen, WED | SAT));
});
