import type { Standing } from './deadline.ts';
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

/** A course level on home (ADR 0020); other decks are in «Мои колоды». */
export interface Deck {
  id: string;
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
  /** The word to hear, in individual practice only (ADR 0047): never put on screen. */
  pronunciation: { key: string; text: string } | null;
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

/** Which words a spelling session takes (ADR 0026); `mix` is the main button's. */
export type SpellingMode = 'mix' | 'today' | 'hard' | 'random';
export const SPELLING_SIZES = [5, 10, 20, 30] as const;
export type SpellingSize = (typeof SPELLING_SIZES)[number];

/** Where a learner's spelling stands: each word climbs a short ladder (ADR 0026). */
export interface SpellingState {
  /** Words the main button gives now (at most 10): hard words due, then words never spelled. */
  ready: number;
  /** Hard and climbing words due again. */
  due: number;
  /** New words learned today, and how many of them were never spelled. */
  today: number;
  today_left: number;
  /** Misspelled last time; «умеет писать»; every word met (the pool for «Вразброс»). */
  hard: number;
  known: number;
  met: number;
  /** A spelling session left unfinished: cards answered, right on the first try, and all. */
  paused: { spelled: number; right: number; total: number } | null;
}

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
  /** Where spelling stands now: the summary's next step (ADR 0026). */
  spelling_today: SpellingState;
  /** A spelling session's result (ADR 0016), or null for other sessions. */
  spelling: { words: number; first_try: number; needs_practice: number } | null;
}

/** One local day (ADR 0027). */
export interface StudyDay {
  /** Local calendar date, YYYY-MM-DD */
  date: string;
  /** Any answers that day. */
  active: boolean;
  /** It counts: a session of any kind was finished that day. */
  studied: boolean;
  /** Cards answered that day, of any kind: the calendar's shade. */
  cards: number;
}

/** The whole course (every published level). */
export interface Progress {
  words: { introduced: number; reviewing: number; well_learned: number; due: number };
  today: StudyDay;
  /** Weeks in a row with every promised day done (ADR 0039). */
  streak_weeks: number;
  /** Days with answers in the last year, oldest first; days without any are absent. */
  activity: StudyDay[];
  /** This week's promise: Monday … Sunday, true on the days promised. */
  promised_week: boolean[];
  /** Delayed recall in scheduled reviews over `days` days */
  recall: { recalled: number; reviewed: number; days: number };
  /** Where my spelling stands (ADR 0026). */
  spelling_today: SpellingState;
}

// Mirrors backend/app/schemas/me.py.

export interface Me {
  /** Null until the learner has chosen a pace. */
  daily_target_words: number | null;
  study_days_per_week: number;
  ramp_enabled: boolean;
  notify_morning: boolean;
  notify_afternoon: boolean;
  notify_report: boolean;
  notify_deadline: boolean;
  onboarded: boolean;
  /** When the pace was first chosen: the ramp's weeks count from here. */
  onboarded_at: string | null;
  promise: PromiseInfo;
}

/** The weekdays I promise (0 = Monday … 6 = Sunday), a change waiting for tomorrow, a pause (ADR 0039). */
export interface PromiseInfo {
  weekdays: number[];
  pending: { effective_from: string; weekdays: number[] } | null;
  pause: { from_date: string; until_date: string } | null;
}

/** One day of a member's promise: done, missed, today (still open), later, or off. */
export type DayState = 'done' | 'missed' | 'today' | 'later' | 'off';
/** Today for one member by the promise. */
export type TodayState = 'done' | 'pending' | 'off';

/** Which notifications a learner wants (ADR 0042). */
export type NotificationChoice = 'notify_morning' | 'notify_afternoon' | 'notify_report' | 'notify_deadline';

export type MeUpdate = Partial<
  Pick<Me, 'daily_target_words' | 'study_days_per_week' | 'ramp_enabled' | NotificationChoice>
>;

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
  /** The pace is the whole course's (its levels share one) or this deck's own (ADR 0028). */
  course: boolean;
  /** A teacher's «Выучить к» (YYYY-MM-DD) and today's share of the words left. */
  deadline: string | null;
  deadline_share: number;
  /** Extra new words taken for today only. */
  extra_today: number;
}

export type WordStatus = 'not_started' | 'new' | 'learning' | 'well_learned';

export interface DeckWord {
  position: number;
  word: Word;
  status: WordStatus;
  next_review_at: string | null;
}

// Mirrors backend/app/schemas/groups.py: members are nicknames and member ids, nothing more.

/** What a role may do in a group (ADR 0040); the server says which ones I may. */
export type GroupAction =
  | 'rename'
  | 'give_decks'
  | 'see_standings'
  | 'reset_invite'
  | 'remove_member'
  | 'transfer_ownership'
  | 'delete_group'
  | 'manage_tests';

export interface Group {
  id: string;
  name: string;
  invite_code: string;
  member_count: number;
  role: 'owner' | 'member';
  nickname: string;
  /** The actions my role allows here: the web never repeats the table of rights. */
  can: GroupAction[];
}

export interface GroupPreview {
  name: string;
  member_count: number;
  already_member: boolean;
}

/** The board's periods (ADR 0023). */
export type Period = 'week' | 'month' | 'all';

export interface BoardRow {
  member_id: string;
  nickname: string;
  role: 'owner' | 'member';
  is_me: boolean;
  /** Over the period: words learned (recalled in a later review), days studied, cards answered. */
  learned: number;
  days: number;
  cards: number;
  /** The place by words learned, then days, then weeks in a row (ADR 0027); null with nothing
   * answered in the period. Equal values share a place. */
  rank: number | null;
  /** This week, whatever the period: days promised, and Monday … Sunday studied. */
  promised_days: number;
  week: boolean[];
  /** Weeks in a row with every promised day done. */
  streak_weeks: number;
  /** Finished a session today, in the group's day. */
  studied_today: boolean;
  /** The report (ADR 0039): this week's seven days, promised days missed this month, today. */
  week_states: DayState[];
  month_misses: number;
  promise_today: TodayState;
  /** The weekdays promised, and whether the promise is paused today. */
  promise_weekdays: number[];
  paused: boolean;
  /** Words known (recalled in a later review) and learning (met, not yet known), in all. */
  known: number;
  learning: number;
  /** Each deck given to the group: how many of its words this member has met and learned. */
  decks: MemberDeck[];
}

export interface MemberDeck {
  deck_id: string;
  title: string;
  word_count: number;
  met: number;
  /** Recalled in a later review with any answer but «Снова»: «знаю» on «Прогресс». */
  learned: number;
}

/** A group in the list (ADR 0023): its pulse before opening it. */
export interface GroupSummary extends Group {
  /** Today by the promise: members promised today, those who did it, and me (ADR 0039). */
  today_promised: number;
  today_done: number;
  my_today: TodayState;
  members: { nickname: string; is_me: boolean; studied_today: boolean }[];
  /** The deadline deck I am furthest behind on, if any (ADR 0032). */
  behind_for_class?: { title: string; behind: number; status: 'behind' | 'not_started' } | null;
}

export interface Board {
  group: Group;
  /** The group's today, and by the promise how many members were promised it and did it. */
  today: string;
  today_promised: number;
  today_done: number;
  week_start: string;
  week_end: string;
  period: Period;
  /** Null for all time. */
  period_start: string | null;
  period_end: string;
  rows: BoardRow[];
  /** The whole group over the period. */
  totals: { days: number; learned: number; cards: number };
  assignments: Assignment[];
  /** The test last taken in the group, for the line on its page (ADR 0046). */
  /** Whether any of the group's decks has a test yet. */
  has_tests: boolean;
  latest_test: { title: string; passed: number; students: number } | null;
}

/** A deck given to the group (ADR 0017); its words never change a place on the board. */
export interface Assignment {
  deck_id: string;
  title: string;
  /** Its author's nickname in the group (null once they left), and whether that is me. */
  author: string | null;
  is_mine: boolean;
  word_count: number;
  assigned_at: string;
  /** «Выучить к» (YYYY-MM-DD), or null: each member's own pace (ADR 0028). */
  due_on: string | null;
  /** With a deadline: my own standing; the owner also gets how many are on track (ADR 0030). */
  my_standing?: Standing | null;
  on_track?: number | null;
  /** Words of it I have met (whoever gave it learns it too). */
  mine: number;
  /** The whole group on it: words met against everyone meeting every word; members done. */
  group: { met: number; total: number; finished: number; learners: number };
  /** Every member's counts, the owner's too, for the group's owner only: met, and remembered
   * well (FSRS, as on the progress page). */
  members: { member_id: string; met: number; known: number; standing?: Standing | null }[] | null;
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

/** A deck's page (ADR 0020): my progress on it and what studying it brings today. */
export interface DeckStats {
  id: string;
  title: string;
  kind: 'course' | 'user';
  level: string | null;
  is_mine: boolean;
  author: string | null;
  group_name: string | null;
  word_count: number;
  introduced_count: number;
  learning_count: number;
  review_count: number;
  /** Remembered well (FSRS), as on the progress page. */
  well_learned: number;
  /** «Знаю»: recalled in a later review, as on «Прогресс» (ADR 0034). */
  learned: number;
  /** New words studying it would bring today, within the daily pace. */
  new_today: number;
  next_due_at: string | null;
  locked: boolean;
  /** Spelling covers words from any deck (ADR 0026). */
  spelling_today: SpellingState;
}

/** A card filled in from a word for the manual form; not saved (ADR 0019). */
export interface SuggestedCard extends DeckWordInput {
  flags: WordFlag[];
  provider: 'deepseek' | 'demo';
}

/** A group a deck is given to, with its «Выучить к» (ADR 0028). */
export interface AssignedGroup {
  id: string;
  name: string;
  due_on?: string | null;
}

/** A deck in «Мои колоды», with my counts on it. */
export interface LibraryDeck {
  id: string;
  title: string;
  word_count: number;
  introduced_count: number;
  learning_count: number;
  review_count: number;
  /** New words opening it would bring today, within the deck's own pace (ADR 0028). */
  new_today: number;
  next_due_at: string | null;
  /** A teacher's «Выучить к» for a deck from a group. */
  due_on?: string | null;
  /** Mine: the groups it is given to. From a group: that group and its author's nickname. */
  groups: AssignedGroup[];
  group_name: string | null;
  author: string | null;
}

export interface Library {
  mine: LibraryDeck[];
  from_groups: LibraryDeck[];
}

/** A teacher's deck as its author edits it. */
export interface TeacherDeck {
  id: string;
  title: string;
  status: 'draft' | 'published';
  created_at: string;
  /** `from_course`: the course's own word, linked; its content is not edited here. */
  words: TeacherWord[];
  groups: AssignedGroup[];
  /** Topics it has been grown with, the latest first (ADR 0019). */
  topics: string[];
  /** Photos it can still be drafted from, of 8 (ADR 0029). */
  photos_left: number;
}

/** A word form from an example sentence (backend glossary). */
export interface GlossaryEntry {
  ru: string;
  lemma: string | null;
  note: string | null;
}

/** One deck on «Прогресс» (ADR 0022): what I've learned of it. */
export interface DeckProgress {
  id: string;
  title: string;
  kind: 'course' | 'user';
  level: string | null;
  is_mine: boolean;
  author: string | null;
  group_name: string | null;
  word_count: number;
  /** Met at least once; learned: recalled in a later review; known: remembered well (FSRS). */
  met: number;
  learned: number;
  known: number;
  last_studied_at: string | null;
  /** Today in this deck (ADR 0028): new words met and the day's goal (0: none left to meet). */
  new_today: number;
  goal_today: number;
  due_on: string | null;
  /** New words a day in it: «≈ N дней до конца» (ADR 0033). */
  pace: number;
}

export interface Knowledge {
  decks: DeckProgress[];
  /** Words first recalled since Monday: «+N за эту неделю» (ADR 0034). */
  learned_this_week: number;
  /** Over distinct words: a word in two decks counts once. */
  met: number;
  learned: number;
  known: number;
}

// Mirrors backend/app/schemas/group_tests.py: a running attempt never carries a word or its id.

export type TestAttemptKind = 'test' | 'practice';

export interface TestScore {
  correct: number;
  total: number;
  passed: boolean;
}

export interface TestDeck {
  deck_id: string;
  title: string;
  has_test: boolean;
  is_open: boolean;
  mine: TestScore | null;
}

export interface GroupTests {
  can_manage: boolean;
  decks: TestDeck[];
}

export interface TestResultRow {
  member_id: string;
  nickname: string;
  is_me: boolean;
  score: TestScore | null;
}

export interface WeakWord {
  word: string;
  translation: string;
}

export interface TestDetail {
  deck_id: string;
  title: string;
  can_manage: boolean;
  test: { words: number; minutes: number; pass_percent: number; is_open: boolean } | null;
  passed: TestResultRow[];
  failed: TestResultRow[];
  not_taken: TestResultRow[];
  mine: {
    state: 'none' | 'running' | 'done';
    attempt_id: string | null;
    deadline_at: string | null;
    score: TestScore | null;
    /** An unfinished practice to go back to. */
    practice_attempt_id: string | null;
    weak: WeakWord[];
  };
}

export interface TestSetupInfo {
  title: string;
  words: { id: string; headword: string; translation: string }[];
  saved: boolean;
  question_count: number | null;
  excluded_word_ids: string[];
  pass_percent: number;
  minutes: number;
  /** Timed attempts that a change of words would erase. */
  results: number;
}

export interface TestSettings {
  question_count: number | null;
  excluded_word_ids: string[];
  pass_percent: number;
  minutes: number;
  reset?: boolean;
}

export interface TestAttempt {
  id: string;
  kind: TestAttemptKind;
  deck_id: string;
  title: string;
  answered: number;
  total: number;
  deadline_at: string | null;
  question: SpellingExercise | null;
  result: {
    correct: number;
    total: number;
    /** Practice has no pass mark. */
    passed: boolean | null;
    timed_out: boolean;
    /** `answer` is null for a word the time ran out on. */
    mistakes: { translation: string; word: string; answer: string | null }[];
  } | null;
}
