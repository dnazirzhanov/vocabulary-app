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

/** "The N most frequent words cover about P% of running text" — only sent when sourced. */
export interface CourseGoal {
  target_words: number;
  coverage_percent: number;
}

export interface Deck {
  id: string;
  title: string;
  description: string;
  course_goal: CourseGoal | null;
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
  points: number;
  today_points: number;
  daily_goal: number;
}

export interface DayActivity {
  /** Local calendar date, YYYY-MM-DD */
  date: string;
  points: number;
}

export interface Progress {
  deck_id: string;
  words: { introduced: number; reviewing: number; well_learned: number; due: number };
  today: DayActivity;
  daily_goal: number;
  streak_days: number;
  /** The last 7 local days, oldest first */
  week: DayActivity[];
  /** Delayed recall in scheduled reviews over `days` days */
  recall: { recalled: number; reviewed: number; days: number };
  points_total: number;
}

// Mirrors backend/app/schemas/me.py.

export interface Me {
  /** Null until the learner has chosen a pace. */
  daily_target_words: number | null;
  study_days_per_week: number;
  ramp_enabled: boolean;
  onboarded: boolean;
}

export type MeUpdate = Partial<Pick<Me, 'daily_target_words' | 'study_days_per_week' | 'ramp_enabled'>>;

export interface PaceSuggestion {
  kind: 'lower' | 'raise';
  value: number;
  reason: 'missed_target' | 'low_recall' | 'steady';
  achieved_per_day: number | null;
  recall_percent: number | null;
}

export interface Pace {
  deck_id: string;
  target: number;
  /** Lower than `target` while a large target warms up (first two weeks). */
  effective_target: number;
  ramp_week: number | null;
  new_words_today: number;
  remaining_today: number;
  next_lesson_size: number;
  bonus: boolean;
  blocked_by_reviews: boolean;
  due_count: number;
  review_debt_limit: number;
  seconds_per_exercise: number;
  suggestion: PaceSuggestion | null;
}
