import { plural } from '../i18n/plural.ts';

/**
 * Pace presets and the time they cost (ADR 0010). Named by time, not difficulty, so no choice reads
 * as "weak". The rules mirror backend/app/services/pace.py; every number is a pilot hypothesis.
 */
export const PRESETS = [
  { id: 'calm', name: 'Спокойный', words: 3 },
  { id: 'normal', name: 'Обычный', words: 5 },
  { id: 'fast', name: 'Быстрый', words: 10 },
  { id: 'intensive', name: 'Интенсив', words: 20 },
] as const;

export const MIN_TARGET = 1;
export const MAX_TARGET = 100;
/** Targets from here warm up over two weeks (half, then three quarters). */
export const RAMP_MIN_TARGET = 10;
/** From here the screen spells out what the target will cost once reviews add up. */
export const REALITY_CHECK_TARGET = 20;
export const DEFAULT_SECONDS_PER_EXERCISE = 10;

// A new word takes three exercises (introduce, choose, type); each of its ~5 reviews takes two.
const EXERCISES_PER_NEW_WORD = 3;
const REVIEWS_PER_WORD = 5;
const EXERCISES_PER_REVIEW = 2;

/** Daily minutes once reviews have built up (after about a month), from first principles. */
export function dailyMinutes(words: number, secondsPerExercise = DEFAULT_SECONDS_PER_EXERCISE): number {
  const exercises = words * (EXERCISES_PER_NEW_WORD + REVIEWS_PER_WORD * EXERCISES_PER_REVIEW);
  return Math.max(1, Math.round((exercises * secondsPerExercise) / 60));
}

/** "≈ 11 мин", "≈ 1 ч 05 мин". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `≈\u00a0${minutes}\u00a0мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `≈\u00a0${hours}\u00a0ч` : `≈\u00a0${hours}\u00a0ч ${String(rest).padStart(2, '0')}\u00a0мин`;
}

export function wordsLabel(count: number): string {
  return `${count}\u00a0${plural(count, { one: 'слово', few: 'слова', many: 'слов' })}`;
}

export function presetFor(words: number) {
  return PRESETS.find((preset) => preset.words === words);
}
