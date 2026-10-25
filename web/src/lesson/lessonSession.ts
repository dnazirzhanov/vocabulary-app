import type { ChoiceExercise } from './types.ts';

export type LessonPhase = 'answering' | 'feedback' | 'complete';

export interface AnswerResult {
  exerciseId: string;
  selectedId: string;
  correct: boolean;
}

export interface LessonState {
  index: number;
  selectedId: string | null;
  phase: LessonPhase;
  results: AnswerResult[];
}

export type LessonAction =
  | { type: 'select'; optionId: string }
  | { type: 'check' }
  | { type: 'continue' }
  | { type: 'restart' };

export function createLessonState(): LessonState {
  return { index: 0, selectedId: null, phase: 'answering', results: [] };
}

/**
 * Every transition is guarded by phase, so repeated clicks or key presses
 * can never record an answer twice or skip an exercise.
 */
export function reduceLesson(
  state: LessonState,
  action: LessonAction,
  exercises: readonly ChoiceExercise[],
): LessonState {
  const exercise = exercises[state.index];

  switch (action.type) {
    case 'select': {
      if (state.phase !== 'answering') return state;
      if (!exercise.options.some((option) => option.id === action.optionId)) return state;
      return { ...state, selectedId: action.optionId };
    }
    case 'check': {
      if (state.phase !== 'answering' || state.selectedId === null) return state;
      const result: AnswerResult = {
        exerciseId: exercise.id,
        selectedId: state.selectedId,
        correct: state.selectedId === exercise.answerId,
      };
      return { ...state, phase: 'feedback', results: [...state.results, result] };
    }
    case 'continue': {
      if (state.phase !== 'feedback') return state;
      const isLast = state.index === exercises.length - 1;
      if (isLast) return { ...state, phase: 'complete', selectedId: null };
      return { ...state, index: state.index + 1, selectedId: null, phase: 'answering' };
    }
    case 'restart':
      return createLessonState();
  }
}
