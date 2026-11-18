import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateSpellingMinutes, estimateVocabMinutes, levelFits, planToday } from './plan.ts';
import type { MentorInput } from './types.ts';

const base: MentorInput = {
  phase: 'morning',
  name: 'Ira',
  streakWeeks: 0,
  decks: [],
  articles: [],
  readIds: new Set(),
  userLevel: 'A2',
  daysSinceLastStudy: null,
  goal: null,
  dailyMinutes: null,
};

test('an empty state yields an empty plan — nothing is invented', () => {
  assert.deepEqual(planToday(base), []);
});

test('one deck with due cards yields one vocab item', () => {
  const plan = planToday({
    ...base,
    decks: [{ id: 'd1', title: 'Family', level: 'A1', levelOrder: 1, dueCount: 7, spellingDue: 0 }],
  });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], { kind: 'vocab', deckId: 'd1', title: 'Family', count: 7, minutes: 2 });
});

test('vocab, spelling, and reading combine in that order', () => {
  const plan = planToday({
    ...base,
    decks: [{ id: 'd1', title: 'Family', level: 'A1', levelOrder: 1, dueCount: 5, spellingDue: 3 }],
    articles: [{ id: 'bees', title: 'How bees dance', level: 'A2', minutes: 4 }],
  });
  assert.deepEqual(
    plan.map((item) => item.kind),
    ['vocab', 'spelling', 'reading'],
  );
});

test('deck with the most due cards wins — ties broken by level, then title', () => {
  const plan = planToday({
    ...base,
    decks: [
      { id: 'd1', title: 'Zoo', level: 'A2', levelOrder: 2, dueCount: 5, spellingDue: 0 },
      { id: 'd2', title: 'Apple', level: 'A1', levelOrder: 1, dueCount: 5, spellingDue: 0 },
      { id: 'd3', title: 'Birds', level: 'A1', levelOrder: 1, dueCount: 5, spellingDue: 0 },
    ],
  });
  assert.equal(plan[0].kind, 'vocab');
  assert.equal((plan[0] as { deckId: string }).deckId, 'd2');
});

test('zero due means no vocab item (nothing is invented)', () => {
  const plan = planToday({
    ...base,
    decks: [{ id: 'd1', title: 'Family', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 0 }],
  });
  assert.deepEqual(plan, []);
});

test('reading prefers an exact level, then the shortest within one step', () => {
  const plan = planToday({
    ...base,
    userLevel: 'B1',
    articles: [
      { id: 'a', title: 'Bees', level: 'A2', minutes: 3 },
      { id: 'b', title: 'Cells', level: 'B1', minutes: 8 },
      { id: 'c', title: 'Cities', level: 'B1', minutes: 5 },
      { id: 'd', title: 'Comets', level: 'C1', minutes: 2 },
    ],
  });
  const reading = plan.find((item) => item.kind === 'reading');
  assert.ok(reading);
  assert.equal((reading as { articleId: string }).articleId, 'c');
});

test('reading falls back to ±1 level when nothing at the exact level is left', () => {
  const plan = planToday({
    ...base,
    userLevel: 'B1',
    articles: [
      { id: 'a', title: 'Bees', level: 'A2', minutes: 3 },
      { id: 'b', title: 'Cells', level: 'C1', minutes: 2 },
    ],
  });
  const reading = plan.find((item) => item.kind === 'reading');
  assert.equal((reading as { articleId: string } | undefined)?.articleId, 'a');
});

test('articles already read are skipped', () => {
  const plan = planToday({
    ...base,
    userLevel: 'A2',
    articles: [{ id: 'bees', title: 'Bees', level: 'A2', minutes: 4 }],
    readIds: new Set(['bees']),
  });
  assert.equal(
    plan.find((item) => item.kind === 'reading'),
    undefined,
  );
});

test('vocab and spelling are picked independently — best-vocab deck may differ from best-spelling deck', () => {
  // Deck A is best for vocab; Deck B is best for spelling.
  const plan = planToday({
    ...base,
    decks: [
      { id: 'A', title: 'Animals', level: 'A1', levelOrder: 1, dueCount: 10, spellingDue: 1 },
      { id: 'B', title: 'Fruits', level: 'A1', levelOrder: 1, dueCount: 0, spellingDue: 8 },
    ],
  });
  const vocab = plan.find((i) => i.kind === 'vocab');
  const spell = plan.find((i) => i.kind === 'spelling');
  assert.equal((vocab as { deckId: string } | undefined)?.deckId, 'A');
  assert.equal((spell as { deckId: string } | undefined)?.deckId, 'B');
});

test('reading tie-break: same minutes picks alphabetically by title', () => {
  const plan = planToday({
    ...base,
    userLevel: 'A2',
    articles: [
      { id: 'z', title: 'Zebras', level: 'A2', minutes: 4 },
      { id: 'a', title: 'Apples', level: 'A2', minutes: 4 },
    ],
  });
  const reading = plan.find((i) => i.kind === 'reading');
  assert.equal((reading as { articleId: string } | undefined)?.articleId, 'a');
});

test('each deck appears as a separate task — vocab decks first, then spelling, then reading', () => {
  const plan = planToday({
    ...base,
    decks: [
      { id: 'd1', title: 'Animals', level: 'A1', levelOrder: 1, dueCount: 5, spellingDue: 3 },
      { id: 'd2', title: 'Fruits', level: 'A1', levelOrder: 1, dueCount: 2, spellingDue: 7 },
    ],
    articles: [{ id: 'a1', title: 'Bees', level: 'A2', minutes: 3 }],
  });
  // 2 vocab + 2 spelling + 1 reading = 5
  assert.equal(plan.length, 5);
  assert.deepEqual(
    plan.map((i) => i.kind),
    ['vocab', 'vocab', 'spelling', 'spelling', 'reading'],
  );
  // vocab ordered by dueCount desc
  assert.equal((plan[0] as { deckId: string }).deckId, 'd1');
  assert.equal((plan[1] as { deckId: string }).deckId, 'd2');
  // spelling ordered by spellingDue desc
  assert.equal((plan[2] as { deckId: string }).deckId, 'd2');
  assert.equal((plan[3] as { deckId: string }).deckId, 'd1');
});

test('daily budget trims items to fit — first item always kept', () => {
  const plan = planToday({
    ...base,
    dailyMinutes: 3,
    decks: [
      { id: 'd1', title: 'Animals', level: 'A1', levelOrder: 1, dueCount: 20, spellingDue: 0 },
      { id: 'd2', title: 'Fruits', level: 'A1', levelOrder: 1, dueCount: 20, spellingDue: 0 },
    ],
    articles: [{ id: 'a1', title: 'Bees', level: 'A2', minutes: 4 }],
  });
  // d1 vocab ~4 min, d2 vocab ~4 min, reading 4 min — budget 3 min keeps only d1 (first item)
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'vocab');
});

test('daily budget includes items that fit cumulatively', () => {
  const plan = planToday({
    ...base,
    dailyMinutes: 10,
    decks: [
      { id: 'd1', title: 'Animals', level: 'A1', levelOrder: 1, dueCount: 6, spellingDue: 0 },
      { id: 'd2', title: 'Fruits', level: 'A1', levelOrder: 1, dueCount: 6, spellingDue: 0 },
    ],
  });
  // d1 ~1 min, d2 ~1 min, total 2 min — both fit in 10 min budget
  assert.equal(plan.length, 2);
});

test('no trimming when dailyMinutes is null', () => {
  const plan = planToday({
    ...base,
    dailyMinutes: null,
    decks: [
      { id: 'd1', title: 'Animals', level: 'A1', levelOrder: 1, dueCount: 10, spellingDue: 5 },
      { id: 'd2', title: 'Fruits', level: 'A1', levelOrder: 1, dueCount: 10, spellingDue: 5 },
    ],
    articles: [{ id: 'a1', title: 'Bees', level: 'A2', minutes: 4 }],
  });
  // null budget → all 5 items (2 vocab + 2 spelling + 1 reading)
  assert.equal(plan.length, 5);
});

test('level-fits allows at most one step away', () => {
  assert.equal(levelFits('A2', 'A2'), true);
  assert.equal(levelFits('A1', 'A2'), true);
  assert.equal(levelFits('B1', 'A2'), true);
  assert.equal(levelFits('B2', 'A2'), false);
  assert.equal(levelFits('C1', 'A1'), false);
});

test('minute estimates stay within sensible bounds', () => {
  assert.equal(estimateVocabMinutes(1), 1);
  assert.equal(estimateVocabMinutes(6), 1);
  assert.equal(estimateVocabMinutes(30), 5);
  assert.equal(estimateVocabMinutes(1000), 15);
  assert.equal(estimateSpellingMinutes(1), 1);
  assert.equal(estimateSpellingMinutes(10), 3);
});
