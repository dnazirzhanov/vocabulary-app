import type { AttemptResult, CardExercise, Rating, Session } from '../lib/types.ts';

/**
 * front → back → saving → (next card) … → finishing        (ADR 0012)
 *                  ↘ error ↗ (retry)       ↘ error ↗ (retry)
 * The learner tries to recall from the front, reveals the back, then rates. A card the server
 * wants to show again this session is inserted where the server put it.
 */
export type CardPhase = 'front' | 'back' | 'saving' | 'error' | 'finishing';

export interface CardRunState {
  cards: CardExercise[];
  index: number;
  phase: CardPhase;
  /** The rating being saved (or to retry after an error). */
  rating: Rating | null;
  results: AttemptResult[];
  failed: 'rating' | 'finish' | null;
  error: string | null;
}

export type CardRunAction =
  | { type: 'reveal' }
  | { type: 'rate'; rating: Rating }
  | { type: 'saved'; result: AttemptResult }
  | { type: 'failed'; message: string }
  | { type: 'retry' };

export function startCardRun(session: Session): CardRunState {
  // Resume after the last rated card; the server enforces this order too.
  const index = session.results.length;
  return {
    cards: session.exercises,
    index,
    phase: index >= session.exercises.length ? 'finishing' : 'front',
    rating: null,
    results: session.results,
    failed: null,
    error: null,
  };
}

export function reduceCardRun(state: CardRunState, action: CardRunAction): CardRunState {
  const card = state.cards[state.index];
  switch (action.type) {
    case 'reveal':
      return state.phase === 'front' ? { ...state, phase: 'back' } : state;
    case 'rate':
      return state.phase === 'back' ? { ...state, phase: 'saving', rating: action.rating } : state;
    case 'saved': {
      if (state.phase !== 'saving' || action.result.exercise_id !== card?.id) return state;
      const cards = [...state.cards];
      const { appended, appended_index: at } = action.result;
      if (appended && at !== null && !cards.some((existing) => existing.id === appended.id)) {
        cards.splice(Math.min(at, cards.length), 0, appended);
      }
      const index = state.index + 1;
      return {
        cards,
        index,
        phase: index >= cards.length ? 'finishing' : 'front',
        rating: null,
        results: [...state.results, action.result],
        failed: null,
        error: null,
      };
    }
    case 'failed':
      if (state.phase === 'saving') return { ...state, phase: 'error', failed: 'rating', error: action.message };
      if (state.phase === 'finishing') return { ...state, phase: 'error', failed: 'finish', error: action.message };
      return state;
    case 'retry':
      if (state.phase !== 'error') return state;
      return { ...state, phase: state.failed === 'finish' ? 'finishing' : 'saving', failed: null, error: null };
  }
}

/** Counters like Anki's: new cards, reviews, and cards being relearned, still ahead. */
export function remaining(state: CardRunState): { fresh: number; review: number } {
  const ahead = state.cards.slice(state.index);
  const fresh = ahead.filter((card) => card.new).length;
  return { fresh, review: ahead.length - fresh };
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
