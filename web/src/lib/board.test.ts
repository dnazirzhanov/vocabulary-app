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
  days: 0,
  plan_days: 0,
  learned: 0,
  cards: 0,
  ranks: { steady: null, learned: null, cards: null },
  promised_days: 5,
  week: Array(7).fill(false),
  streak_weeks: 0,
  studied_today: false,
  ...values,
});
const rows = (count: number, me: number): BoardRow[] =>
  Array.from({ length: count }, (_, index) =>
    member(`n${index}`, { is_me: index === me, ranks: { steady: index + 1, learned: null, cards: null } }),
  );
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

const ranks = (steady: number | null, learned: number | null, cards: number | null) => ({ steady, learned, cards });

test('the standing names who to pass and what it takes, by the first measure that differs', () => {
  const board = [
    member('Ахмед', { days: 5, plan_days: 4, learned: 30, cards: 200, ranks: ranks(1, 1, 1) }),
    member('Искандер', { days: 4, plan_days: 4, learned: 12, cards: 150, ranks: ranks(2, 3, 2) }),
    member('я', { is_me: true, days: 4, plan_days: 2, learned: 20, cards: 90, ranks: ranks(3, 2, 3) }),
    member('Тихий', {}),
  ];
  // Same days as Искандер, fewer with the plan done: passing him takes 3 more (his 4, my 2, plus one).
  assert.deepEqual(standingOf(board, 'steady'), {
    kind: 'chasing',
    rank: 3,
    ahead: 'Искандер',
    aheadRank: 2,
    need: 3,
    measure: 'plan_days',
  });
  assert.deepEqual(standingOf(board, 'cards'), {
    kind: 'chasing',
    rank: 3,
    ahead: 'Искандер',
    aheadRank: 2,
    need: 61,
    measure: 'value',
  });
  assert.deepEqual(standingOf(board, 'learned'), {
    kind: 'chasing',
    rank: 2,
    ahead: 'Ахмед',
    aheadRank: 1,
    need: 11,
    measure: 'value',
  });
});

test('at the top the standing says who shares it and who is closest behind', () => {
  const board = [
    member('я', { is_me: true, days: 5, ranks: ranks(1, null, null) }),
    member('Ахмед', { days: 5, ranks: ranks(1, null, null) }),
    member('Парвиз', { days: 2, ranks: ranks(3, null, null) }),
  ];
  assert.deepEqual(standingOf(board, 'steady'), {
    kind: 'top',
    shared: ['Ахмед'],
    next: { nickname: 'Парвиз', behind: 3 },
  });
  assert.deepEqual(standingOf([member('я', { is_me: true })], 'steady'), { kind: 'unranked' });
});
