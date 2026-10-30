import type { BoardRow } from './types.ts';

export const FULL_BOARD = 10;

export type BoardLine = { kind: 'row'; row: BoardRow } | { kind: 'gap'; hidden: number };

/**
 * Up to 10 ranked members: everyone. More: the top 3 plus the learner and two neighbours on each
 * side, so everybody sees people near their own level (relative boards motivate across levels;
 * ADR 0011). Unranked members are listed separately by the screen.
 */
export function visibleLines(ranked: BoardRow[]): BoardLine[] {
  if (ranked.length <= FULL_BOARD) return ranked.map((row) => ({ kind: 'row', row }));
  const me = ranked.findIndex((row) => row.is_me);
  const keep = new Set<number>([0, 1, 2]);
  if (me >= 0) for (let index = me - 2; index <= me + 2; index += 1) keep.add(index);
  const lines: BoardLine[] = [];
  let hidden = 0;
  ranked.forEach((row, index) => {
    if (keep.has(index)) {
      if (hidden > 0) lines.push({ kind: 'gap', hidden });
      hidden = 0;
      lines.push({ kind: 'row', row });
    } else hidden += 1;
  });
  if (hidden > 0) lines.push({ kind: 'gap', hidden });
  return lines;
}

/** "1-м", "2-м", "3-м"… for "вы на 2-м месте". */
export const placeOrdinal = (rank: number) => `${rank}-м`;

/** What a place is decided by (ADR 0027): words learned, then days studied, then weeks in a row. */
export const scoreOf = (row: BoardRow): number[] => [row.learned, row.days, row.streak_weeks];

/** Ranked members, best first; members without a place are left out. */
export function ranked(rows: BoardRow[]): BoardRow[] {
  return rows
    .filter((row) => row.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.nickname.localeCompare(b.nickname, 'ru'));
}

/** What a tie is broken by, in order after words learned. */
export type Measure = 'learned' | 'days' | 'streak';

/** What moving up takes: the member just ahead and how much more it needs to pass them, or, at
 * the top, who is closest behind and by how many words. */
export type Standing =
  | { kind: 'unranked' }
  | { kind: 'top'; shared: string[]; next: { nickname: string; behind: number } | null }
  | { kind: 'chasing'; rank: number; ahead: string; aheadRank: number; need: number; measure: Measure };

export function standingOf(rows: BoardRow[]): Standing {
  const board = ranked(rows);
  const me = board.find((row) => row.is_me);
  if (!me) return { kind: 'unranked' };
  const place = me.rank ?? 0;
  const mine = scoreOf(me);
  if (place === 1) {
    const shared = board.filter((row) => row.rank === 1 && !row.is_me).map((row) => row.nickname);
    const next = board.find((row) => (row.rank ?? 0) > 1);
    return {
      kind: 'top',
      shared,
      next: next ? { nickname: next.nickname, behind: me.learned - next.learned } : null,
    };
  }
  // The nearest place above mine: everyone sharing it is passed together.
  const above = board.filter((row) => (row.rank ?? 0) < place).at(-1)!;
  const theirs = scoreOf(above);
  const index = theirs.findIndex((value, at) => value !== mine[at]);
  const measures = ['learned', 'days', 'streak'] as const;
  return {
    kind: 'chasing',
    rank: place,
    ahead: above.nickname,
    aheadRank: above.rank ?? 0,
    // To pass, one more than they have on the first measure that differs.
    need: theirs[index] - mine[index] + 1,
    measure: measures[index],
  };
}
