import { addDays, dayStart, studyDay } from './time.ts';

/**
 * Spelling on the device (ADR 0016, 0026, 0062): building a word from tiles, checking it, and the
 * ladder that decides which words to spell, as backend/app/services/spelling.py and
 * spelling_ladder.py do. web/src/study/vectors.json keeps them equal.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const MIN_TILES = 15;
const MIN_DISTRACTORS = 4;

/** Forgive what is not spelling: case and surrounding spaces. */
export const normalize = (answer: string) => answer.normalize('NFKC').trim().toLowerCase();

export const isCorrect = (answer: string, target: string) =>
  normalize(answer) !== '' && normalize(answer) === normalize(target);

/** The letters to build, without a phrase's separators. */
export const letters = (target: string) => [...normalize(target)].filter((char) => LETTERS.includes(char)).join('');

/** A phrase's fixed gaps: [letters before it, the character]. */
export function separators(target: string): [number, string][] {
  const gaps: [number, string][] = [];
  let count = 0;
  for (const char of normalize(target)) {
    if (LETTERS.includes(char)) count += 1;
    else gaps.push([count, char]);
  }
  return gaps;
}

/**
 * The letter bank: every letter of the word and a few not in it, in alphabetical order unless that
 * spells the word (then shuffled). `random` returns [0, 1).
 */
export function tiles(target: string, random: () => number): string[] {
  const word = [...letters(target)];
  const absent = [...LETTERS].filter((letter) => !word.includes(letter));
  const count = Math.max(MIN_TILES, word.length + MIN_DISTRACTORS);
  const distractors: string[] = [];
  const pool = [...absent];
  while (distractors.length < count - word.length) {
    distractors.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  const bank = [...word, ...distractors].sort();
  const spelled = word.join('');
  // One letter ("a", "i") is always "spelled" by its own tile: nothing to hide.
  if (word.length <= 1) return bank;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!bank.join('').includes(spelled)) return bank;
    for (let i = bank.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [bank[i], bank[j]] = [bank[j], bank[i]];
    }
  }
  throw new Error(`no tile order hides ${spelled}`);
}

// --- the ladder (ADR 0026) ------------------------------------------------------------------

export const HARD = 0;
export const KNOWN = 3;
const WAIT_DAYS: Record<number, number> = { 0: 1, 1: 3, 2: 7, 3: 21 };
export type Mode = 'mix' | 'today' | 'hard' | 'random';
export const DEFAULT_SIZE = 10;
const RANDOM_WEIGHT = { never: 3.0, climbing: 1.5, known: 0.25 };

export interface Spelled {
  rung: number;
  dueAt: number;
  lastSpelledAt: number;
}

/** The word's rung after a first try at `now`; `right` is false for a miss or a hinted answer. */
export function afterSpelling(before: Spelled | null, right: boolean, now: number, timeZone: string): Spelled {
  if (right && before !== null && before.dueAt > now) return { ...before, lastSpelledAt: now };
  const rung = !right ? HARD : before === null ? 1 : Math.min(before.rung + 1, KNOWN);
  return { rung, dueAt: dayStart(addDays(studyDay(now, timeZone), WAIT_DAYS[rung]), timeZone), lastSpelledAt: now };
}

/** What a learner can spell from in one deck. */
export interface Words {
  /** Met words, oldest first. */
  met: readonly string[];
  /** Today's new words, in the order learned. */
  today: readonly string[];
  ladder: ReadonlyMap<string, Spelled>;
  todayStart: number;
}

function due(words: Words, now: number): string[] {
  return [...words.ladder.entries()]
    .filter(([, spelled]) => spelled.rung < KNOWN && spelled.dueAt <= now)
    .sort(([, a], [, b]) => a.rung - b.rung || a.dueAt - b.dueAt)
    .map(([word]) => word);
}

/** Words never spelled: today's in the order learned, then older ones, latest met first. */
function fresh(words: Words): string[] {
  const learnedToday = new Set(words.today);
  const today = words.today.filter((word) => !words.ladder.has(word));
  const older = [...words.met].reverse().filter((word) => !words.ladder.has(word) && !learnedToday.has(word));
  return [...today, ...older];
}

export function pick(mode: Mode, size: number, words: Words, now: number, random: () => number): string[] {
  let chosen: string[];
  if (mode === 'mix') chosen = [...due(words, now), ...fresh(words)];
  else if (mode === 'today') {
    const spelledToday = (word: string) => {
      const spelled = words.ladder.get(word);
      return spelled !== undefined && spelled.lastSpelledAt >= words.todayStart ? 1 : 0;
    };
    // Stable: in the order learned, not yet spelled today first.
    chosen = [...words.today].sort((a, b) => spelledToday(a) - spelledToday(b));
  } else if (mode === 'hard') {
    chosen = [...words.ladder.entries()]
      .filter(([, spelled]) => spelled.rung === HARD)
      .sort(([, a], [, b]) => a.dueAt - b.dueAt)
      .map(([word]) => word);
  } else {
    const weight = (word: string) => {
      const spelled = words.ladder.get(word);
      if (!spelled) return RANDOM_WEIGHT.never;
      return spelled.rung === KNOWN ? RANDOM_WEIGHT.known : RANDOM_WEIGHT.climbing;
    };
    // Weighted sampling without replacement: highest u^(1/w) first.
    chosen = words.met
      .map((word) => ({ word, key: random() ** (1 / weight(word)) }))
      .sort((a, b) => b.key - a.key)
      .map(({ word }) => word);
  }
  return chosen.slice(0, size);
}

export interface Overview {
  ready: number;
  due: number;
  today: number;
  todayLeft: number;
  hard: number;
  known: number;
  met: number;
}

export function overview(words: Words, now: number): Overview {
  const neverSpelled = new Set(fresh(words));
  const dueNow = due(words, now).length;
  const rungs = [...words.ladder.values()].map((spelled) => spelled.rung);
  return {
    ready: Math.min(dueNow + neverSpelled.size, DEFAULT_SIZE),
    due: dueNow,
    today: words.today.length,
    todayLeft: words.today.filter((word) => neverSpelled.has(word)).length,
    hard: rungs.filter((rung) => rung === HARD).length,
    known: rungs.filter((rung) => rung === KNOWN).length,
    met: words.met.length,
  };
}
