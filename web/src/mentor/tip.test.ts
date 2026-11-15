import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickTip } from './tip.ts';
import type { MentorInput } from './types.ts';

const base: MentorInput = {
  phase: 'morning',
  name: 'Ira',
  streakWeeks: 0,
  decks: [],
  articles: [],
  readIds: new Set(),
  userLevel: 'A2',
};

test('a fresh account with no decks and no streak gets the first-run tip', () => {
  assert.deepEqual(pickTip(base), { id: 'firstRun' });
});

test('a four-week streak is a milestone (and beats the plain keep-it-up)', () => {
  assert.deepEqual(pickTip({ ...base, streakWeeks: 4 }), { id: 'streakMilestone', weeks: 4 });
  assert.deepEqual(pickTip({ ...base, streakWeeks: 8 }), { id: 'streakMilestone', weeks: 8 });
});

test('other streak lengths get a keep-it-up', () => {
  assert.deepEqual(pickTip({ ...base, streakWeeks: 1 }), { id: 'streakKeep', weeks: 1 });
  assert.deepEqual(pickTip({ ...base, streakWeeks: 3 }), { id: 'streakKeep', weeks: 3 });
  assert.deepEqual(pickTip({ ...base, streakWeeks: 5 }), { id: 'streakKeep', weeks: 5 });
});

test('a big backlog wins over a plain deck line', () => {
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Family', level: null, levelOrder: null, dueCount: 60, spellingDue: 0 }],
  });
  assert.deepEqual(tip, { id: 'bigBacklog', total: 60 });
});

test('a deck with ten or more due words is called out by name', () => {
  const tip = pickTip({
    ...base,
    decks: [
      { id: 'd1', title: 'Family', level: 'A1', levelOrder: 1, dueCount: 12, spellingDue: 0 },
      { id: 'd2', title: 'Food', level: 'A1', levelOrder: 1, dueCount: 3, spellingDue: 0 },
    ],
  });
  assert.deepEqual(tip, { id: 'dueInDeck', count: 12, deckTitle: 'Family' });
});

test('spelling-awaits appears when five or more words want spelling and nothing earlier matches', () => {
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Food', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 6 }],
  });
  assert.deepEqual(tip, { id: 'spellingAwaits', count: 6 });
});

test('all caught up fires when a learner has decks but zero vocab and spelling due', () => {
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Food', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 0 }],
  });
  assert.deepEqual(tip, { id: 'allCaughtUp' });
});

test('all caught up beats reading-fresh when nothing is due and articles exist', () => {
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Food', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 0 }],
    articles: [{ id: 'bees', title: 'Bees', level: 'A2', minutes: 4 }],
  });
  assert.deepEqual(tip, { id: 'allCaughtUp' });
});

test('with no vocabulary due and some (not enough) spelling, suggest reading', () => {
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Food', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 2 }],
    articles: [{ id: 'bees', title: 'Bees', level: 'A2', minutes: 4 }],
  });
  assert.deepEqual(tip, { id: 'readingFresh' });
});

test('with only a small spelling queue, no reading, and no streak, the default shows', () => {
  // totalDue === 0 → newLearner skipped; spellingDue < 5 → spellingAwaits skipped; no articles
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Food', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 2 }],
  });
  assert.deepEqual(tip, { id: 'default' });
});

test('a learner with decks and due vocab but no streak yet gets the new-learner tip', () => {
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Family', level: 'A1', levelOrder: 1, dueCount: 5, spellingDue: 0 }],
  });
  assert.deepEqual(tip, { id: 'newLearner' });
});

test('new-learner tip fires even with a few spelling words alongside vocab', () => {
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Family', level: 'A1', levelOrder: 1, dueCount: 3, spellingDue: 2 }],
  });
  assert.deepEqual(tip, { id: 'newLearner' });
});

test('new-learner requires vocab due — no-vocab learner bypasses it', () => {
  // totalDue === 0 so newLearner does not fire; falls through to default
  const tip = pickTip({
    ...base,
    decks: [{ id: 'd1', title: 'Family', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 3 }],
  });
  assert.deepEqual(tip, { id: 'default' });
});

test('the first-run rule needs both no decks and no streak', () => {
  // A learner with a streak but no decks today still gets the streak keep-it-up, not first-run.
  assert.deepEqual(pickTip({ ...base, streakWeeks: 2 }), { id: 'streakKeep', weeks: 2 });
});
