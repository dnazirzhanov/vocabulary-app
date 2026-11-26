import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Deck, Library, LibraryDeck } from '../lib/types.ts';
import { studyToday, withSeen, type StudyItem } from './studyPlan.ts';

const lib = (id: string, title: string, counts: [number, number, number], extra: Partial<LibraryDeck> = {}) =>
  ({
    id,
    title,
    word_count: 20,
    introduced_count: 5,
    new_today: counts[0],
    learning_count: counts[1],
    review_count: counts[2],
    next_due_at: null,
    groups: [],
    group_name: null,
    author: null,
    ...extra,
  }) as LibraryDeck;

const course = (id: string, title: string, order: number, counts: [number, number, number], locked = false) =>
  ({
    id,
    title,
    level_order: order,
    locked,
    new_today: counts[0],
    learning_count: counts[1],
    review_count: counts[2],
  }) as unknown as Deck;

test('deadlines first (nearest first), then the course by level, then group and own decks; spelling last', () => {
  const library: Library = {
    from_groups: [
      lib('g1', 'online-vs-offline-learning', [5, 0, 2], { due_on: '2026-11-30', group_name: '7Б' }),
      lib('g2', 'Travel', [0, 1, 0], { due_on: '2026-11-26', group_name: '7Б' }),
      lib('g3', 'Food', [3, 0, 0], { group_name: '7Б' }),
      lib('g4', 'Done for today', [0, 0, 0], { due_on: '2026-11-25' }),
    ],
    mine: [lib('m1', 'My words', [0, 0, 4])],
  };
  const items = studyToday(
    [course('c2', 'B1–B2', 2, [0, 0, 3]), course('c1', 'A1–A2', 1, [5, 2, 1]), course('c3', 'C1', 3, [5, 0, 0], true)],
    library,
    [
      { id: 'c1', title: 'A1–A2', spellingDue: 3 },
      { id: 'm1', title: 'My words', spellingDue: 8 },
      { id: 'x', title: 'Nothing', spellingDue: 0 },
    ],
  );
  assert.deepEqual(
    items.map((i) => `${i.kind}:${i.title}`),
    [
      'learn:Travel',
      'learn:online-vs-offline-learning',
      'learn:A1–A2',
      'learn:B1–B2',
      'learn:Food',
      'learn:My words',
      'spell:My words',
      'spell:A1–A2',
    ],
  );
  const first = items[1];
  assert.deepEqual([first.newCount, first.dueCount, first.dueOn, first.group], [5, 2, '2026-11-30', '7Б']);
});

test('nothing waiting: nothing shown', () => {
  assert.deepEqual(studyToday([], null, []), []);
});

test('a deck studied today stays on the list, ticked; the celebration is once', () => {
  const item = (key: string, extra: Partial<StudyItem> = {}): StudyItem => ({
    key,
    kind: 'learn',
    deckId: key,
    title: key,
    newCount: 5,
    dueCount: 0,
    dueOn: null,
    group: null,
    ...extra,
  });
  // Morning: two decks waiting.
  const morning = withSeen([item('a'), item('b')], {});
  assert.deepEqual(morning.fresh, []);
  // After studying «a»: only «b» waits; «a» is shown done, and is fresh.
  const after = withSeen([item('b')], morning.seen);
  assert.deepEqual(
    after.items.map((i) => [i.key, i.done ?? false]),
    [
      ['b', false],
      ['a', true],
    ],
  );
  assert.deepEqual(after.fresh, ['a']);
  // Looked at again: still done, no longer fresh.
  const again = withSeen([item('b')], after.seen);
  assert.deepEqual(again.fresh, []);
  assert.equal(again.items.find((i) => i.key === 'a')?.done, true);
  // Words come back to it later the same day: waiting again.
  assert.equal(withSeen([item('a'), item('b')], again.seen).items.find((i) => i.key === 'a')?.done, undefined);
});
