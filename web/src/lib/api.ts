import { accessToken } from './auth.ts';
import { syncWithServer } from './clock.ts';
import type {
  AttemptResponse,
  AttemptResult,
  Deck,
  DeckWord,
  Me,
  MeUpdate,
  Pace,
  Progress,
  Session,
  Summary,
} from './types.ts';

/** `network`: no response at all (offline, timeout). `http`: the server answered with an error. */
export class ApiError extends Error {
  readonly kind: 'network' | 'http';
  readonly status: number;
  readonly code: string;

  constructor(kind: 'network' | 'http', status: number, code: string, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const TIMEOUT_MS = 15_000;
// The server counts days (daily goal, streaks) in the learner's own time zone.
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        'X-Time-Zone': timeZone,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('network', 0, 'network_error', 'The request did not reach the server');
  }
  syncWithServer(response.headers.get('X-Server-Time'));
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError('http', response.status, error?.code ?? 'http_error', error?.message ?? response.statusText);
  }
  return data as T;
}

export const api = {
  listDecks: () => request<Deck[]>('GET', '/decks'),
  activeSession: () => request<{ session: Session | null }>('GET', '/sessions/active'),
  startNewSession: (deckId: string) => request<Session>('POST', '/sessions', { kind: 'new', deck_id: deckId }),
  startReviewSession: (deckId: string) => request<Session>('POST', '/sessions', { kind: 'review', deck_id: deckId }),
  startPracticeSession: (sourceSessionId: string) =>
    request<Session>('POST', '/sessions', { kind: 'practice', source_session_id: sourceSessionId }),
  // Safe to retry: the server keeps exactly one attempt per exercise.
  submitAttempt: (sessionId: string, exerciseId: string, response: AttemptResponse) =>
    request<AttemptResult>('POST', `/sessions/${sessionId}/attempts`, { exercise_id: exerciseId, response }),
  completeSession: (sessionId: string) => request<Summary>('POST', `/sessions/${sessionId}/complete`),
  deckProgress: (deckId: string) => request<Progress>('GET', `/decks/${deckId}/progress`),
  deckWords: (deckId: string) => request<DeckWord[]>('GET', `/decks/${deckId}/words`),
  me: () => request<Me>('GET', '/me'),
  updateMe: (changes: MeUpdate) => request<Me>('PATCH', '/me', changes),
  pace: (deckId: string) => request<Pace>('GET', `/me/pace?deck_id=${encodeURIComponent(deckId)}`),
  dismissSuggestion: (kind: 'lower' | 'raise') => request<null>('POST', '/me/pace/dismiss', { kind }),
  /** Deletes the learner's account data on our server (sessions, answers, progress). */
  deleteAccount: () => request<null>('DELETE', '/me'),
};

/** Learner-facing message for a failed request. Never shown for a wrong answer. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'network') {
    return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  }
  if (error instanceof ApiError && error.status >= 500) {
    return 'Сервер сейчас не отвечает. Попробуйте ещё раз через минуту.';
  }
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}
