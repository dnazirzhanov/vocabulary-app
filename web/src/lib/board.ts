import type { BoardRow, Ranking } from './types.ts';

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

/** The value a ranking compares, highest first (ADR 0023). Steadiness: days studied, then days
 * with the plan done, then weeks in a row. */
export const valueOf = (row: BoardRow, ranking: Ranking): number[] =>
  ranking === 'steady'
    ? [row.days, row.plan_days, row.streak_weeks]
    : [ranking === 'learned' ? row.learned : row.cards];

/** Ranked members by a ranking, best first; members without a place are left out. */
export function rankedBy(rows: BoardRow[], ranking: Ranking): BoardRow[] {
  return rows
    .filter((row) => row.ranks[ranking] !== null)
    .sort((a, b) => (a.ranks[ranking] ?? 0) - (b.ranks[ranking] ?? 0) || a.nickname.localeCompare(b.nickname, 'ru'));
}

/** What moving up takes: the member just ahead and how much more of the ranking's measure it
 * needs to pass them, or, at the top, who is closest behind and by how much. */
export type Standing =
  | { kind: 'unranked' }
  | { kind: 'top'; shared: string[]; next: { nickname: string; behind: number } | null }
  | {
      kind: 'chasing';
      rank: number;
      ahead: string;
      aheadRank: number;
      need: number;
      measure: 'days' | 'plan_days' | 'streak' | 'value';
    };

export function standingOf(rows: BoardRow[], ranking: Ranking): Standing {
  const ranked = rankedBy(rows, ranking);
  const me = ranked.find((row) => row.is_me);
  if (!me) return { kind: 'unranked' };
  const place = me.ranks[ranking] ?? 0;
  const mine = valueOf(me, ranking);
  if (place === 1) {
    const shared = ranked.filter((row) => row.ranks[ranking] === 1 && !row.is_me).map((row) => row.nickname);
    const next = ranked.find((row) => (row.ranks[ranking] ?? 0) > 1);
    return {
      kind: 'top',
      shared,
      next: next ? { nickname: next.nickname, behind: mine[0] - valueOf(next, ranking)[0] } : null,
    };
  }
  // The nearest place above mine: everyone sharing it is passed together.
  const above = ranked.filter((row) => (row.ranks[ranking] ?? 0) < place).at(-1)!;
  const theirs = valueOf(above, ranking);
  const index = theirs.findIndex((value, at) => value !== mine[at]);
  const measures = ['days', 'plan_days', 'streak'] as const;
  return {
    kind: 'chasing',
    rank: place,
    ahead: above.nickname,
    aheadRank: above.ranks[ranking] ?? 0,
    // To pass, one more than they have on the first measure that differs.
    need: theirs[index] - mine[index] + 1,
    measure: ranking === 'steady' ? measures[index] : 'value',
  };
}
