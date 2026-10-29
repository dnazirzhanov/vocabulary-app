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

/** 1 Снова, 2 Трудно, 3 Хорошо, 4 Легко (ADR 0012). */
export type Rating = 1 | 2 | 3 | 4;

/** A flashcard: the answer travels with it; the learner reveals it and rates their recall. */
export interface CardExercise {
  id: string;
  type: 'card';
  word: Word;
  /** The word's first showing ever: the back introduces it. */
  new: boolean;
  /** When the card comes back for each rating, shown under the buttons. */
  previews: { rating: Rating; seconds: number }[];
}

export type Exercise = CardExercise;

export type SessionKind = 'study' | 'hard';

export interface AttemptResult {
  exercise_id: string;
  rating: Rating;
  next_due_at: string;
  /** Another showing of the card later in this session, and where it goes. */
  appended: CardExercise | null;
  appended_index: number | null;
}

export interface Session {
  id: string;
  kind: SessionKind;
  deck_id: string;
  completed: boolean;
  exercises: CardExercise[];
  results: AttemptResult[];
}

export interface SummaryWord {
  word: Word;
  /** The last and the lowest rating in this session, and how often the card was shown. */
  rating: Rating;
  lowest_rating: Rating;
  showings: number;
  next_review_at: string;
}

export interface Summary {
  session_id: string;
  kind: SessionKind;
  deck_id: string;
  words: SummaryWord[];
  new_words: number;
  reviewed_words: number;
  ratings: { again: number; hard: number; good: number; easy: number };
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
  /** When the pace was first chosen: the ramp's weeks count from here. */
  onboarded_at: string | null;
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

export type WordStatus = 'not_started' | 'new' | 'learning' | 'well_learned';

export interface DeckWord {
  position: number;
  word: Word;
  status: WordStatus;
  next_review_at: string | null;
}

// Mirrors backend/app/schemas/groups.py: members are nicknames and member ids, nothing more.

export interface Group {
  id: string;
  name: string;
  invite_code: string;
  member_count: number;
  role: 'owner' | 'member';
  nickname: string;
}

export interface GroupPreview {
  name: string;
  member_count: number;
  already_member: boolean;
}

export interface BoardRow {
  member_id: string;
  nickname: string;
  role: 'owner' | 'member';
  is_me: boolean;
  /** Null for members with no points yet this week. */
  rank: number | null;
  days_practised: number;
  /** Monday … Sunday: was the daily goal met? */
  week: boolean[];
  points: number;
  streak_days: number;
}

export interface Board {
  group: Group;
  week_start: string;
  week_end: string;
  rows: BoardRow[];
  goal: { done: number; target: number };
}

/** A word form from an example sentence (backend glossary). */
export interface GlossaryEntry {
  ru: string;
  lemma: string | null;
  note: string | null;
}
