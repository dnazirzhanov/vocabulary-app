import { plural } from '../i18n/plural.ts';

/** The first-run choices and the limits of a pace (ADR 0010, 0045); mirrored in backend/app/services/pace.py. */
export const PRESETS = [
  { id: 'calm', words: 3 },
  { id: 'normal', words: 5 },
  { id: 'fast', words: 10 },
  { id: 'intensive', words: 20 },
] as const;

export const MIN_TARGET = 1;
export const MAX_TARGET = 100;

export function wordsLabel(count: number): string {
  return `${count}\u00a0${plural(count, { one: 'слово', few: 'слова', many: 'слов' })}`;
}
