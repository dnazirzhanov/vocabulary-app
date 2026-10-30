import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standingOf, visibleLines } from './board.ts';
import { nicknameProblem, suggestNicknames } from './nickname.ts';
import type { BoardRow } from './types.ts';

const member = (nickname: string, values: Partial<BoardRow> = {}): BoardRow => ({
  member_id: nickname,
  nickname,
  role: 'member',
  is_me: false,
  learned: 0,
  days: 0,
  cards: 0,
  rank: null,
  promised_days: 5,
  week: Array(7).fill(false),
  streak_weeks: 0,
  studied_today: false,
  ...values,
});
const rows = (count: number, me: number): BoardRow[] =>
  Array.from({ length: count }, (_, index) => member(`n${index}`, { is_me: index === me, rank: index + 1 }));
const shape = (lines: ReturnType<typeof visibleLines>) =>
  lines.map((line) => (line.kind === 'gap' ? `…${line.hidden}` : line.row.nickname));

test('small boards show everyone', () => {
  assert.equal(visibleLines(rows(10, 9)).length, 10);
});

test('big boards show the top 3 and the learner with two neighbours each side', () => {
  assert.deepEqual(shape(visibleLines(rows(20, 10))), ['n0', 'n1', 'n2', '…5', 'n8', 'n9', 'n10', 'n11', 'n12', '…7']);
  assert.deepEqual(shape(visibleLines(rows(20, 3))), ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', '…14']);
  assert.deepEqual(shape(visibleLines(rows(20, 19))), ['n0', 'n1', 'n2', '…14', 'n17', 'n18', 'n19']);
});

test('generated nicknames agree and pass the rules', () => {
  let seed = 0;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const names = suggestNicknames(5, random);
  assert.equal(new Set(names).size, 5);
  for (const name of names) assert.equal(nicknameProblem(name), null, name);
});

test('typed nicknames follow the server rules', () => {
  assert.equal(nicknameProblem('  Ёжик   7 '), null);
  assert.equal(nicknameProblem('ivan@mail.ru'), 'Только буквы, цифры, пробел и дефис.');
  assert.equal(nicknameProblem('0555123456'), 'Имя не может быть номером.');
  assert.equal(nicknameProblem('wwwfun'), 'Без ссылок.');
  assert.equal(nicknameProblem('a'), 'Не короче 2 символов.');
});

test('the standing names who to pass and what it takes: words, or the first tie-break that differs', () => {
  const board = [
    member('Ахмед', { learned: 30, days: 5, rank: 1 }),
    member('Искандер', { learned: 20, days: 4, streak_weeks: 2, rank: 2 }),
    member('я', { is_me: true, learned: 20, days: 4, rank: 3 }),
    member('Тихий', {}),
  ];
  // Same words and days as Искандер, but his streak is longer: passing him takes 3 weeks in a row.
  assert.deepEqual(standingOf(board), {
    kind: 'chasing',
    rank: 3,
    ahead: 'Искандер',
    aheadRank: 2,
    need: 3,
    measure: 'streak',
  });
  const learner = board.map((row) => (row.is_me ? { ...row, learned: 12 } : row));
  // Fewer words: 9 more passes him (his 20, my 12, plus one).
  assert.deepEqual(standingOf(learner), {
    kind: 'chasing',
    rank: 3,
    ahead: 'Искандер',
    aheadRank: 2,
    need: 9,
    measure: 'learned',
  });
});

test('at the top the standing says who shares it and who is closest behind', () => {
  const board = [
    member('я', { is_me: true, learned: 15, days: 3, rank: 1 }),
    member('Ахмед', { learned: 15, days: 3, rank: 1 }),
    member('Парвиз', { learned: 12, days: 2, rank: 3 }),
  ];
  assert.deepEqual(standingOf(board), { kind: 'top', shared: ['Ахмед'], next: { nickname: 'Парвиз', behind: 3 } });
  assert.deepEqual(standingOf([member('я', { is_me: true })]), { kind: 'unranked' });
});
