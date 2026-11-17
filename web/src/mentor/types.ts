import type { Level } from '../reading/levels.ts';

/** Time of day used for the greeting line. */
export type GreetingPhase = 'morning' | 'afternoon' | 'evening' | 'night';

/** A deck as the planner reads it: counts of what's due today. */
export interface MentorDeck {
  id: string;
  title: string;
  level: string | null;
  levelOrder: number | null;
  dueCount: number;
  spellingDue: number;
}

/** An article as the planner reads it: just what's needed to pick and launch one. */
export interface MentorArticle {
  id: string;
  title: string;
  level: Level;
  minutes: number;
}

/** The learner's chosen goal type. */
export type MentorGoalType = 'ielts' | 'conversation' | 'travel' | 'business' | 'academic' | 'general';

/** Everything the planner and tip need, gathered once per screen load. */
export interface MentorInput {
  /** Time of day, derived from the device clock before we call `planToday` / `pickTip`. */
  phase: GreetingPhase;
  /** The learner's name; null when the account hasn't given one. */
  name: string | null;
  /** Weeks in a row with every promised day done; null when we never had a snapshot. */
  streakWeeks: number | null;
  /** Every deck on this device, with its due vocabulary and spelling counts. */
  decks: MentorDeck[];
  /** The library, with the learner's reading level filled in. */
  articles: MentorArticle[];
  /** Article ids this learner has finished (`doneAt` is set on this device). */
  readIds: ReadonlySet<string>;
  /** The learner's reading level, derived from the course deck they are on. */
  userLevel: Level;
  /** Calendar days since the last completed study session; null when no history or data unavailable. */
  daysSinceLastStudy: number | null;
  /** The goal type code set during onboarding; null means onboarding not done yet. */
  goal: string | null;
  /** Daily study budget in minutes; null when not set. Used to cap the plan. */
  dailyMinutes: number | null;
}

/** One card on «Today's plan». */
export type PlanItem =
  | { kind: 'vocab'; deckId: string; title: string; count: number; minutes: number }
  | { kind: 'spelling'; deckId: string; title: string; count: number; minutes: number }
  | { kind: 'reading'; articleId: string; title: string; level: Level; minutes: number };

/** Which canned tip is chosen; first match wins in `pickTip`. */
export type TipId =
  | 'firstRun'
  | 'newLearner'
  | 'streakMilestone'
  | 'streakKeep'
  | 'bigBacklog'
  | 'dueInDeck'
  | 'spellingAwaits'
  | 'returner'
  | 'allCaughtUp'
  | 'readingFresh'
  | 'default';

/** A tip and the numbers/deck title it carries, so the renderer can pass them to `t`. */
export interface Tip {
  id: TipId;
  weeks?: number;
  total?: number;
  count?: number;
  deckTitle?: string;
  days?: number;
}
