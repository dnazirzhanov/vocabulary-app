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
  /** 'course': a level. 'group': a deck a teacher gave one of my groups (ADR 0017), listed first. */
  kind: 'course' | 'group';
  /** Where a group deck comes from: its group, its author's nickname there (null once they left),
   * and whether I wrote it. */
  group_name: string | null;
  author: string | null;
  is_mine: boolean;
  title: string;
  description: string;
  /** The course level ("A1–A2") and its place; a later level is locked until this one is met (ADR 0014). */
  level: string | null;
  level_order: number;
  locked: boolean;
  course_goal: CourseGoal | null;
  word_count: number;
  introduced_count: number;
  /** Cards due now: `learning_count` still in short learning steps plus `review_count` long-term reviews. */
  due_count: number;
  learning_count: number;
  review_count: number;
  /** New words this deck offers today (what is left of the daily pace; 0 on other levels). */
  new_today: number;
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

/** A spelling card (ADR 0016): build the word from its meaning; the word is never sent. */
export interface SpellingExercise {
  id: string;
  type: 'spelling';
  prompt: { translation: string; pos: string };
  /** Letters in the word. */
  slots: number;
  /** A phrase's spaces, hyphens and apostrophes: fixed gaps after `after` letters, never tiles. */
  separators: Separator[];
  /** Letter tiles in display order; a tile is known by its position. */
  tiles: string[];
  /** The card's one hint, once given: a slot and its letter. */
  hint: Hint | null;
}

export interface Separator {
  after: number;
  char: string;
}

export interface Hint {
  position: number;
  letter: string;
}

export type Exercise = CardExercise | SpellingExercise;

export type SessionKind = 'study' | 'hard' | 'spelling';

export interface AttemptResult {
  exercise_id: string;
  /** Cards: the rating and when the card is due next. */
  rating: Rating | null;
  next_due_at: string | null;
  /** Spelling: built right at the first try, and the word itself (shown once answered). */
  correct: boolean | null;
  answer: string | null;
  /** Exercises this answer added later in the lesson, and where they go. */
  inserted: { index: number; exercise: Exercise }[];
}

export interface Session {
  id: string;
  kind: SessionKind;
  deck_id: string;
  completed: boolean;
  exercises: Exercise[];
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
  /** Today's plan once this session is done (ADR 0015); practice is never part of it. */
  today: TodayPlan;
  /** A spelling session's result (ADR 0016), or null for other sessions. */
  spelling: { words: number; first_try: number; needs_practice: number } | null;
}

export interface TodayPlan {
  new_words: number;
  target: number;
  plan_done: boolean;
  /** New words beyond today's target: extra, never part of the plan. */
  extra_new: number;
  /** Today's spelling, the plan's second part (ADR 0016). */
  spelling: { words: number; done: number };
}

/** One local day (ADR 0015). */
export interface PlanDay {
  /** Local calendar date, YYYY-MM-DD */
  date: string;
  /** Any answers that day, practice included. */
  active: boolean;
  /** The day's own plan was done. */
  plan_done: boolean;
  new_words: number;
  /** New words the plan asked for (0: no new word was possible; the reviews were the plan). */
  target: number;
}

/** The whole course (every published level). */
export interface Progress {
  words: { introduced: number; reviewing: number; well_learned: number; due: number };
  today: PlanDay;
  /** Weeks in a row with the promise kept. */
  streak_weeks: number;
  /** Days with answers in the last year, oldest first; days without any are absent. */
  activity: PlanDay[];
  /** This week's promise: days with the plan done. */
  promised_days: number;
  /** Delayed recall in scheduled reviews over `days` days */
  recall: { recalled: number; reviewed: number; days: number };
  /** Today's planned new words to spell, and how many a finished spelling session covered. */
  spelling_today: { words: number; done: number };
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
  /** Null for members with no answers yet this week. */
  rank: number | null;
  /** Days this week with the member's own plan done, against the days promised (ADR 0015). */
  plan_days: number;
  promised_days: number;
  /** Monday … Sunday: was the plan done? */
  week: boolean[];
  /** Weeks in a row with the promise kept. */
  streak_weeks: number;
}

/** A learner's week against their own promise (ADR 0015); mirrors backend/app/schemas/profile.py. */
export interface Profile {
  /** The nickname in the group it was opened from; null for one's own profile. */
  nickname: string | null;
  is_me: boolean;
  week_start: string;
  week_end: string;
  words_per_day: number;
  promised_days: number;
  plan_days: number;
  /** Monday … Sunday: was the plan done? */
  week: boolean[];
  today_index: number;
  planned_words: number;
  streak_weeks: number;
  words_total: number;
  /** Learning beyond the plan: recognised here, never on the board. */
  extra: { new_words: number; practice_answers: number };
}

export interface Board {
  group: Group;
  week_start: string;
  week_end: string;
  rows: BoardRow[];
  goal: { done: number; target: number };
  assignments: Assignment[];
}

/** A deck given to the group (ADR 0017); its words never change a place on the board. */
export interface Assignment {
  deck_id: string;
  title: string;
  word_count: number;
  assigned_at: string;
  /** Words of it I have met (whoever gave it learns it too). */
  mine: number;
  /** Every member's count, the owner's too, for the group's owner only. */
  members: { member_id: string; met: number }[] | null;
}

export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase' | 'other';

/** A word as a teacher writes it (backend/app/schemas/decks.py). */
export interface DeckWordInput {
  headword: string;
  pos: PartOfSpeech;
  translation: string;
  example: string;
  example_ru: string;
}

export type WordFlag = 'translation_not_russian' | 'example_without_word' | 'example_long';

export interface TeacherWord {
  word: Word;
  from_course: boolean;
  /** The sentence of the teacher's material it was drafted from (ADR 0018). */
  source_sentence: string | null;
  /** What the teacher should check. */
  flags: WordFlag[];
}

/** Cards drafted from a teacher's text (ADR 0018), added to the deck for review. */
export interface GenerateResult {
  deck: TeacherDeck;
  added: number;
  skipped: { headword: string; reason: 'duplicate' | 'invalid' | 'too_long' | 'full' }[];
  /** 'demo': placeholder cards, made without any service (development only). */
  provider: 'deepseek' | 'demo';
}

/** A teacher's deck as its author edits it. */
export interface TeacherDeck {
  id: string;
  title: string;
  status: 'draft' | 'published';
  created_at: string;
  /** `from_course`: the course's own word, linked; its content is not edited here. */
  words: TeacherWord[];
  groups: { id: string; name: string }[];
}

/** A word form from an example sentence (backend glossary). */
export interface GlossaryEntry {
  ru: string;
  lemma: string | null;
  note: string | null;
}
