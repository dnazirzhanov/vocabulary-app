import type { CourseGoal, Deck } from './types.ts';

/** The whole course: every level's words, measured against the course goal (ADR 0014). */
export interface Course {
  course_goal: CourseGoal | null;
  word_count: number;
  introduced_count: number;
}

export function courseOf(decks: Deck[]): Course {
  // Home's decks are the course's levels (ADR 0020).
  const levels = decks;
  return {
    course_goal: levels.find((deck) => deck.course_goal)?.course_goal ?? null,
    word_count: levels.reduce((sum, deck) => sum + deck.word_count, 0),
    introduced_count: levels.reduce((sum, deck) => sum + deck.introduced_count, 0),
  };
}

/** The course goal (1,300 words) when there is a sourced one, otherwise the words in the app. */
export const goalWordsOf = (course: Course) => Math.max(course.course_goal?.target_words ?? 0, course.word_count);
