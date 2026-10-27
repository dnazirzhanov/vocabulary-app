import type { AttemptResult, Exercise, Rating, Session } from '../lib/types.ts';

/**
 * A card:     front → back → saving → (next) …                         (ADR 0012)
 * Spelling:   front (building) → saving → feedback → (next) …          (ADR 0016)
 * … → finishing. A failed request goes to error and back (retry) with the same answer.
 * The learner recalls from a card's front, reveals the back, then rates it; a spelling exercise
 * is built with tiles, checked by the server, then explained before moving on. Exercises an
 * answer adds (a card shown again, practice and a retry after a missed recall) are inserted where
 * the server put them.
 */
export type LessonPhase = 'front' | 'back' | 'saving' | 'feedback' | 'error' | 'finishing';

export type Answer = { kind: 'rating'; rating: Rating } | { kind: 'spelling'; answer: string; hintUsed: boolean };

export interface LessonState {
  exercises: Exercise[];
  index: number;
  phase: LessonPhase;
  /** The answer being saved (or to retry after an error). */
  pending: Answer | null;
  /** The result shown as feedback for the current spelling exercise. */
  last: AttemptResult | null;
  results: AttemptResult[];
  failed: 'answer' | 'finish' | null;
  error: string | null;
}

export type LessonAction =
  | { type: 'reveal' }
  | { type: 'rate'; rating: Rating }
  | { type: 'spell'; answer: string; hintUsed: boolean }
  | { type: 'saved'; result: AttemptResult }
  | { type: 'continue' }
  | { type: 'failed'; message: string }
  | { type: 'retry' };

export function startLesson(session: Session): LessonState {
  // Resume after the last answered exercise; the server enforces this order too.
  const index = session.results.length;
  return {
    exercises: session.exercises,
    index,
    phase: index >= session.exercises.length ? 'finishing' : 'front',
    pending: null,
    last: null,
    results: session.results,
    failed: null,
    error: null,
  };
}

function advance(state: LessonState, exercises: Exercise[]): LessonState {
  const index = state.index + 1;
  return {
    ...state,
    exercises,
    index,
    phase: index >= exercises.length ? 'finishing' : 'front',
    pending: null,
    last: null,
    failed: null,
    error: null,
  };
}

export function reduceLesson(state: LessonState, action: LessonAction): LessonState {
  const current = state.exercises[state.index];
  const isCard = current?.type === 'card';
  switch (action.type) {
    case 'reveal':
      return state.phase === 'front' && isCard ? { ...state, phase: 'back' } : state;
    case 'rate':
      return state.phase === 'back' && isCard
        ? { ...state, phase: 'saving', pending: { kind: 'rating', rating: action.rating } }
        : state;
    case 'spell':
      return state.phase === 'front' && !isCard
        ? { ...state, phase: 'saving', pending: { kind: 'spelling', answer: action.answer, hintUsed: action.hintUsed } }
        : state;
    case 'saved': {
      if (state.phase !== 'saving' || action.result.exercise_id !== current?.id) return state;
      const exercises = [...state.exercises];
      for (const { index, exercise } of action.result.inserted) {
        if (!exercises.some((existing) => existing.id === exercise.id)) {
          exercises.splice(Math.min(index, exercises.length), 0, exercise);
        }
      }
      const saved = { ...state, results: [...state.results, action.result] };
      if (isCard) return advance(saved, exercises);
      return { ...saved, exercises, phase: 'feedback', pending: null, last: action.result };
    }
    case 'continue':
      return state.phase === 'feedback' ? advance(state, state.exercises) : state;
    case 'failed':
      if (state.phase === 'saving') return { ...state, phase: 'error', failed: 'answer', error: action.message };
      if (state.phase === 'finishing') return { ...state, phase: 'error', failed: 'finish', error: action.message };
      return state;
    case 'retry':
      if (state.phase !== 'error') return state;
      return { ...state, phase: state.failed === 'finish' ? 'finishing' : 'saving', failed: null, error: null };
  }
}

/** Counters like Anki's: new cards and reviews still ahead, and spelling exercises. */
export function remaining(state: LessonState): { fresh: number; review: number; spelling: number } {
  const ahead = state.exercises.slice(state.index);
  const cards = ahead.filter((exercise) => exercise.type === 'card');
  const fresh = cards.filter((card) => card.new).length;
  return { fresh, review: cards.length - fresh, spelling: ahead.length - cards.length };
}

/** "<1 мин", "10 мин", "3 дн", "2 мес" — the interval under a rating button. */
export function formatInterval(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 1) return '<1 мин';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} ч`;
  const days = hours / 24;
  if (days < 31) return `${Math.round(days)} дн`;
  if (days < 365) return `${Math.round(days / 30)} мес`;
  return `${(days / 365).toFixed(1).replace('.0', '')} г`;
}
