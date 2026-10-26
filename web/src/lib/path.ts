import type { DeckWord } from './types.ts';

/**
 * The deck as a path of stepping stones (M8): every 5 words in deck order are a stone, every two
 * stones a level. Derived from the word list, so the path and the list can never disagree.
 */
export const STONE_WORDS = 5;
export const STONES_PER_LEVEL = 2;

export type StoneState = 'locked' | 'current' | 'done' | 'firm';

export interface Stone {
  /** 1-based, across the whole deck. */
  number: number;
  level: number;
  words: DeckWord[];
  met: number;
  firm: number;
  /** Words on this stone whose review is due now. */
  due: number;
  state: StoneState;
}

export interface Level {
  number: number;
  stones: Stone[];
}

export interface DeckPath {
  levels: Level[];
  stones: Stone[];
  /** The stone the learner stands on: the first not fully met, or the last one when all are met. */
  current: Stone | null;
  complete: boolean;
}

export function buildPath(words: DeckWord[], now: Date): DeckPath {
  const stones: Stone[] = [];
  for (let start = 0; start < words.length; start += STONE_WORDS) {
    const group = words.slice(start, start + STONE_WORDS);
    const number = stones.length + 1;
    const met = group.filter((row) => row.status !== 'not_started').length;
    const firm = group.filter((row) => row.status === 'well_learned').length;
    const due = group.filter(
      (row) => row.status !== 'not_started' && row.next_review_at && Date.parse(row.next_review_at) <= now.getTime(),
    ).length;
    stones.push({
      number,
      level: Math.ceil(number / STONES_PER_LEVEL),
      words: group,
      met,
      firm,
      due,
      state: firm === group.length ? 'firm' : met === group.length ? 'done' : 'locked',
    });
  }
  const firstOpen = stones.find((stone) => stone.met < stone.words.length) ?? null;
  if (firstOpen) firstOpen.state = 'current';
  const levels: Level[] = [];
  for (const stone of stones) {
    if (levels.length < stone.level) levels.push({ number: stone.level, stones: [] });
    levels[stone.level - 1].stones.push(stone);
  }
  return {
    levels,
    stones,
    current: firstOpen ?? stones[stones.length - 1] ?? null,
    complete: firstOpen === null && stones.length > 0,
  };
}

/** The hops to animate when the learner comes back to the path: one per stone left behind. */
export function hopsBetween(previous: number | null, current: number): number[] {
  if (previous === null || current <= previous) return [];
  return Array.from({ length: current - previous }, (_, index) => previous + index + 1);
}
