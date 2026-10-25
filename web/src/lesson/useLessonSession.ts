import { useCallback, useReducer } from 'react';
import { createLessonState, reduceLesson, type LessonAction, type LessonState } from './lessonSession.ts';
import type { ChoiceExercise } from './types.ts';

export function useLessonSession(exercises: readonly ChoiceExercise[]) {
  const [state, dispatch] = useReducer(
    (current: LessonState, action: LessonAction) => reduceLesson(current, action, exercises),
    undefined,
    createLessonState,
  );

  return {
    state,
    exercise: exercises[state.index],
    total: exercises.length,
    lastResult: state.phase === 'feedback' ? state.results[state.results.length - 1] : undefined,
    select: useCallback((optionId: string) => dispatch({ type: 'select', optionId }), []),
    check: useCallback(() => dispatch({ type: 'check' }), []),
    next: useCallback(() => dispatch({ type: 'continue' }), []),
    restart: useCallback(() => dispatch({ type: 'restart' }), []),
  };
}
