import { accessToken } from './auth.ts';
import { syncWithServer } from './clock.ts';
import type {
  AttemptResult,
  Board,
  Deck,
  DeckWord,
  GlossaryEntry,
  Group,
  GroupPreview,
  Me,
  MeUpdate,
  Pace,
  Profile,
  Progress,
  Rating,
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
  /** Due cards from every level, then today's new words of this deck (resumes an open session). */
  /** One deck's cards, or with no deck every level's due cards and the current level's new words. */
  startStudySession: (deckId: string | null) =>
    request<Session>('POST', '/sessions', deckId ? { kind: 'study', deck_id: deckId } : { kind: 'study' }),
  /** Extra practice on the learner's hardest words; the schedule is not changed. */
  /** A spelling card for each word learned today (ADR 0016); may be repeated for practice. */
  startSpellingSession: () => request<Session>('POST', '/sessions', { kind: 'spelling' }),
  startHardSession: (deckId: string) => request<Session>('POST', '/sessions', { kind: 'hard', deck_id: deckId }),
  // Safe to retry: the server keeps exactly one rating per showing.
  rateCard: (sessionId: string, exerciseId: string, rating: Rating) =>
    request<AttemptResult>('POST', `/sessions/${sessionId}/attempts`, {
      exercise_id: exerciseId,
      response: { kind: 'rating', rating },
    }),
  /** A word built with letter tiles; the server checks it (the word stays there until then). */
  spell: (sessionId: string, exerciseId: string, answer: string) =>
    request<AttemptResult>('POST', `/sessions/${sessionId}/attempts`, {
      exercise_id: exerciseId,
      response: { kind: 'spelling', answer },
    }),
  completeSession: (sessionId: string) => request<Summary>('POST', `/sessions/${sessionId}/complete`),
  progress: () => request<Progress>('GET', '/progress'),
  myProfile: () => request<Profile>('GET', '/me/profile'),
  memberProfile: (groupId: string, memberId: string) =>
    request<Profile>('GET', `/groups/${groupId}/members/${memberId}/profile`),
  deckWords: (deckId: string) => request<DeckWord[]>('GET', `/decks/${deckId}/words`),
  glossary: () => request<Record<string, GlossaryEntry>>('GET', '/glossary'),
  me: () => request<Me>('GET', '/me'),
  updateMe: (changes: MeUpdate) => request<Me>('PATCH', '/me', changes),
  pace: (deckId: string) => request<Pace>('GET', `/me/pace?deck_id=${encodeURIComponent(deckId)}`),
  dismissSuggestion: (kind: 'lower' | 'raise') => request<null>('POST', '/me/pace/dismiss', { kind }),
  groups: () => request<Group[]>('GET', '/groups'),
  createGroup: (name: string, nickname: string) => request<Group>('POST', '/groups', { name, nickname }),
  previewInvite: (code: string) => request<GroupPreview>('GET', `/groups/join/${encodeURIComponent(code)}`),
  joinGroup: (code: string, nickname: string) =>
    request<Group>('POST', `/groups/join/${encodeURIComponent(code)}`, { nickname }),
  board: (groupId: string) => request<Board>('GET', `/groups/${groupId}/board`),
  leaveGroup: (groupId: string) => request<null>('DELETE', `/groups/${groupId}/members/me`),
  removeMember: (groupId: string, memberId: string) =>
    request<null>('DELETE', `/groups/${groupId}/members/${memberId}`),
  /** Deletes the learner's account data on our server (sessions, answers, progress). */
  deleteAccount: () => request<null>('DELETE', '/me'),
};

// Errors the learner can act on, by the server's error code.
const MESSAGES: Record<string, string> = {
  nickname_taken: 'Это имя уже занято в группе — выберите другое.',
  invalid_nickname: 'Такое имя не подойдёт: только буквы, цифры, пробел и дефис.',
  invalid_group_name: 'Название: от 2 до 40 символов, без ссылок.',
  too_many_groups: 'Можно состоять не больше чем в 5 группах.',
  group_full: 'В этой группе уже 50 участников.',
  rate_limited: 'Слишком много попыток. Подождите минуту.',
};

/** Learner-facing message for a failed request. Never shown for a wrong answer. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError && MESSAGES[error.code]) return MESSAGES[error.code];
  if (error instanceof ApiError && error.kind === 'network') {
    return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  }
  if (error instanceof ApiError && error.status >= 500) {
    return 'Сервер сейчас не отвечает. Попробуйте ещё раз через минуту.';
  }
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}
