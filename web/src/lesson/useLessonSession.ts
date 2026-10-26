import { useCallback, useReducer } from 'react';
import {
  createLessonState,
  reduceLesson,
  type AnswerResult,
  type LessonAction,
  type LessonState,
} from './lessonSession.ts';
import type { ChoiceExercise } from './types.ts';

export function useLessonSession(
  exercises: readonly ChoiceExercise[],
  onComplete: (results: readonly AnswerResult[]) => void,
) {
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
    // Completion is reported in the same event as the final Continue, so the
    // parent swaps to the summary in one render instead of a frame later.
    next: useCallback(() => {
      const following = reduceLesson(state, { type: 'continue' }, exercises);
      dispatch({ type: 'continue' });
      if (following.phase === 'complete') onComplete(following.results);
    }, [state, exercises, onComplete]),
    restart: useCallback(() => dispatch({ type: 'restart' }), []),
  };
}
