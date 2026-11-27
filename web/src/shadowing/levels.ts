import { t } from '../i18n/index.ts';
import type { ShadowingExercise } from './api.ts';

/** An exercise's level, in the app's language. */
export function levelName(level: ShadowingExercise['difficulty']): string {
  if (level === 'beginner') return t.shadowingDifficultyBeginner;
  if (level === 'intermediate') return t.shadowingDifficultyIntermediate;
  return t.shadowingDifficultyAdvanced;
}
