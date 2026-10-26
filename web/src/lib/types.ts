// Mirrors backend/app/schemas/learning.py. Answer keys are absent until a result comes back.

export interface Word {
  id: string;
  headword: string;
  pos: string;
  translation: string;
  example: string;
  example_ru: string;
  illustration: string | null;
}

export interface Deck {
  id: string;
  title: string;
  description: string;
  word_count: number;
  introduced_count: number;
  due_count: number;
  /** The earliest upcoming review when nothing is due yet. */
  next_due_at: string | null;
}

export interface IntroduceExercise {
  id: string;
  type: 'introduce';
  word: Word;
}

export interface ChooseMeaningExercise {
  id: string;
  type: 'choose_meaning';
  word: { headword: string; pos: string; example: string };
  options: { id: string; label: string }[];
}

/** Like choose-meaning, but the options stay hidden until the learner has tried to recall. */
export interface RecallMeaningExercise {
  id: string;
  type: 'recall_meaning';
  word: { headword: string; pos: string; example: string };
  options: { id: string; label: string }[];
}

export interface TypeWordExercise {
  id: string;
  type: 'type_word';
  prompt: { translation: string; pos: string; cloze: string | null; example_ru: string };
}

export type Exercise = IntroduceExercise | ChooseMeaningExercise | RecallMeaningExercise | TypeWordExercise;
export type ChoiceExercise = ChooseMeaningExercise | RecallMeaningExercise;

export type SessionKind = 'new' | 'practice' | 'review';

export interface AttemptResult {
  exercise_id: string;
  /** null for introductions, which are acknowledgements rather than answers */
  correct: boolean | null;
  correct_option_id: string | null;
  answer: Word;
}

export interface Session {
  id: string;
  kind: SessionKind;
  deck_id: string;
  completed: boolean;
  exercises: Exercise[];
  results: AttemptResult[];
}

export type AttemptResponse = { kind: 'seen' } | { kind: 'choice'; option_id: string } | { kind: 'text'; text: string };

export interface Summary {
  session_id: string;
  kind: SessionKind;
  deck_id: string;
  words: { word: Word; mistakes: number; next_review_at: string }[];
  answers_total: number;
  answers_correct: number;
}
