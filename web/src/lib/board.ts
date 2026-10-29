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
