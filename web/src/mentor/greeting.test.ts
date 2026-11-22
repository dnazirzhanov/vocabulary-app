import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phaseFor } from './greeting.ts';

test('morning, afternoon, evening, night each cover their hours', () => {
  const expected: Record<number, ReturnType<typeof phaseFor>> = {
    0: 'night',
    4: 'night',
    5: 'morning',
    11: 'morning',
    12: 'afternoon',
    16: 'afternoon',
    17: 'evening',
    21: 'evening',
    22: 'night',
    23: 'night',
  };
  for (const [hour, phase] of Object.entries(expected)) {
    assert.equal(phaseFor(Number(hour)), phase, `hour ${hour}`);
  }
});

test('every hour of the day has a phase', () => {
  const phases = new Set<string>();
  for (let hour = 0; hour < 24; hour += 1) phases.add(phaseFor(hour));
  assert.deepEqual([...phases].sort(), ['afternoon', 'evening', 'morning', 'night']);
});
