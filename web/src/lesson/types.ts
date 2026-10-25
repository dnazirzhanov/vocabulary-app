import type { IllustrationId } from '../illustrations/index.tsx';

export interface ChoiceOption {
  id: string;
  label: string;
}

/** Show an English word, pick its meaning from translated options. */
export interface ChoiceExercise {
  id: string;
  word: string;
  illustration: IllustrationId;
  /** English description for screen readers; must not reveal the translation. */
  illustrationAlt: string;
  options: ChoiceOption[];
  answerId: string;
}
