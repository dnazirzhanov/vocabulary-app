import type { AnswerResult } from './lessonSession.ts';
import type { ChoiceExercise } from './types.ts';

export interface WordOutcome {
  id: string;
  word: string;
  translation: string;
  illustration: ChoiceExercise['illustration'];
  correct: boolean;
}

export interface SessionSummary {
  total: number;
  correctCount: number;
  /** Answered wrongly this session — offered for immediate practice. */
  missed: WordOutcome[];
  /** Recognised on the first attempt. Recognition, not mastery. */
  recognized: WordOutcome[];
}

export function summarizeSession(
  exercises: readonly ChoiceExercise[],
  results: readonly AnswerResult[],
): SessionSummary {
  const outcomes: WordOutcome[] = [];
  for (const exercise of exercises) {
    const result = results.find((r) => r.exerciseId === exercise.id);
    if (!result) continue;
    outcomes.push({
      id: exercise.id,
      word: exercise.word,
      translation: exercise.options.find((option) => option.id === exercise.answerId)?.label ?? '',
      illustration: exercise.illustration,
      correct: result.correct,
    });
  }
  const recognized = outcomes.filter((outcome) => outcome.correct);
  return {
    total: outcomes.length,
    correctCount: recognized.length,
    missed: outcomes.filter((outcome) => !outcome.correct),
    recognized,
  };
}
