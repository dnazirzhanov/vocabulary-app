import type { AttemptResponse, AttemptResult, Exercise, Session } from '../lib/types.ts';

/**
 * answering → checking → feedback → (next exercise) … → finishing
 *              ↘ error ↗ (retry)                       ↘ error ↗ (retry)
 * Introductions skip feedback: once the server acknowledges one, the next exercise starts.
 */
export type RunPhase = 'answering' | 'checking' | 'feedback' | 'error' | 'finishing';

export interface RunState {
  index: number;
  phase: RunPhase;
  choice: string | null;
  text: string;
  results: AttemptResult[];
  /** What a retry from the error phase repeats, and the message to show meanwhile. */
  failed: 'attempt' | 'finish' | null;
  error: string | null;
}

export type RunAction =
  | { type: 'choose'; optionId: string }
  | { type: 'input'; text: string }
  | { type: 'submit' }
  | { type: 'resolved'; result: AttemptResult }
  | { type: 'failed'; message: string }
  | { type: 'continue' }
  | { type: 'retry' };

export function startRun(session: Session): RunState {
  // Resume after the last answered exercise; the server enforces this order too.
  const index = session.results.length;
  return {
    index,
    phase: index >= session.exercises.length ? 'finishing' : 'answering',
    choice: null,
    text: '',
    results: session.results,
    failed: null,
    error: null,
  };
}

/** The response to send for the current exercise, or null if the learner has not answered yet. */
export function responseFor(exercise: Exercise, state: RunState): AttemptResponse | null {
  if (exercise.type === 'introduce') return { kind: 'seen' };
  if (exercise.type === 'choose_meaning') return state.choice ? { kind: 'choice', option_id: state.choice } : null;
  return state.text.trim() ? { kind: 'text', text: state.text } : null;
}

function advance(state: RunState, exercises: readonly Exercise[], results: AttemptResult[]): RunState {
  const index = state.index + 1;
  return {
    index,
    phase: index >= exercises.length ? 'finishing' : 'answering',
    choice: null,
    text: '',
    results,
    failed: null,
    error: null,
  };
}

export function reduceRun(state: RunState, action: RunAction, exercises: readonly Exercise[]): RunState {
  const exercise = exercises[state.index];
  switch (action.type) {
    case 'choose':
      if (state.phase !== 'answering' || exercise?.type !== 'choose_meaning') return state;
      if (!exercise.options.some((option) => option.id === action.optionId)) return state;
      return { ...state, choice: action.optionId };
    case 'input':
      if (state.phase !== 'answering' || exercise?.type !== 'type_word') return state;
      return { ...state, text: action.text.slice(0, 100) };
    case 'submit':
      if (state.phase !== 'answering' || !exercise || !responseFor(exercise, state)) return state;
      return { ...state, phase: 'checking' };
    case 'resolved': {
      if (state.phase !== 'checking' || action.result.exercise_id !== exercise?.id) return state;
      const results = [...state.results, action.result];
      return exercise.type === 'introduce'
        ? advance(state, exercises, results)
        : { ...state, phase: 'feedback', results };
    }
    case 'failed':
      if (state.phase === 'checking') return { ...state, phase: 'error', failed: 'attempt', error: action.message };
      if (state.phase === 'finishing') return { ...state, phase: 'error', failed: 'finish', error: action.message };
      return state;
    case 'continue':
      if (state.phase !== 'feedback') return state;
      return advance(state, exercises, state.results);
    case 'retry':
      if (state.phase !== 'error') return state;
      return { ...state, phase: state.failed === 'finish' ? 'finishing' : 'checking', failed: null, error: null };
  }
}
