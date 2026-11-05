import { accessToken, dropSession } from './auth.ts';
import { syncWithServer } from './clock.ts';
import type {
  AttemptResult,
  Board,
  Deck,
  DeckStats,
  DeckWord,
  GlossaryEntry,
  Hint,
  Group,
  GroupPreview,
  GroupSummary,
  GroupTests,
  Period,
  Knowledge,
  Me,
  MeUpdate,
  PromiseInfo,
  Pace,
  Progress,
  Rating,
  Session,
  SpellingMode,
  SpellingSize,
  Summary,
  TeacherDeck,
  TestAttempt,
  TestAttemptKind,
  TestDetail,
  TestSettings,
  TestSetupInfo,
  DeckWordInput,
  GenerateResult,
  Library,
  SuggestedCard,
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
const BUSY_RETRIES = 3;
// The server counts days (daily goal, streaks) in the learner's own time zone.
// A whole class starts a test within seconds (ADR 0046). Both requests are safe to repeat, and on a
// busy server a longer wait is kinder than an error in the middle of a timed test.
const TEST_TIMEOUT_MS = 30_000;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = TIMEOUT_MS,
  busyRetries = BUSY_RETRIES,
): Promise<T> {
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
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError('network', 0, 'network_error', 'The request did not reach the server');
  }
  syncWithServer(response.headers.get('X-Server-Time'));
  const data: unknown = await response.json().catch(() => null);
  if (response.status === 401) await dropSession();
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    // The server refused it before doing anything (ADR 0044), so any request is safe to send again.
    // A random wait, so a whole class doesn't come back in the same moment.
    if (error?.code === 'server_busy' && busyRetries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));
      return request<T>(method, path, body, timeoutMs, busyRetries - 1);
    }
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
  /** The letter of the next empty slot of a spelling card: one hint per card (ADR 0016). */
  hint: (sessionId: string, exerciseId: string, position: number) =>
    request<Hint>('POST', `/sessions/${sessionId}/exercises/${exerciseId}/hint`, { position }),
  /** Spelling cards for one set of words (ADR 0026): by default the main button's mix of ten. */
  startSpellingSession: (mode: SpellingMode = 'mix', size: SpellingSize = 10) =>
    request<Session>('POST', '/sessions', { kind: 'spelling', mode, size }),
  startHardSession: (deckId: string) => request<Session>('POST', '/sessions', { kind: 'hard', deck_id: deckId }),
  // Safe to retry: the server keeps exactly one rating per showing.
  rateCard: (sessionId: string, exerciseId: string, rating: Rating) =>
    request<AttemptResult>('POST', `/sessions/${sessionId}/attempts`, {
      exercise_id: exerciseId,
      response: { kind: 'rating', rating },
    }),
  /** A word built with letter tiles; the server checks it (the word stays there until then). */
  spell: (sessionId: string, exerciseId: string, answer: string, heard: boolean) =>
    request<AttemptResult>('POST', `/sessions/${sessionId}/attempts`, {
      exercise_id: exerciseId,
      response: { kind: 'spelling', answer, heard },
    }),
  completeSession: (sessionId: string) => request<Summary>('POST', `/sessions/${sessionId}/complete`),
  progress: () => request<Progress>('GET', '/progress'),
  /** «Прогресс»: what I know, deck by deck (ADR 0022). */
  knowledge: () => request<Knowledge>('GET', '/progress/decks'),
  deckStats: (deckId: string) => request<DeckStats>('GET', `/decks/${deckId}/stats`),
  deckWords: (deckId: string) => request<DeckWord[]>('GET', `/decks/${deckId}/words`),
  glossary: () => request<Record<string, GlossaryEntry>>('GET', '/glossary'),
  me: () => request<Me>('GET', '/me'),
  updateMe: (changes: MeUpdate) => request<Me>('PATCH', '/me', changes),
  /** The weekdays I promise, from tomorrow (ADR 0039). */
  setPromise: (weekdays: number[]) => request<PromiseInfo>('PUT', '/me/promise', { weekdays }),
  /** Pause the promise from tomorrow until a date (at most 31 days); `endPause` drops it. */
  setPause: (until: string) => request<PromiseInfo>('PUT', '/me/promise/pause', { until }),
  endPause: () => request<PromiseInfo>('DELETE', '/me/promise/pause'),
  pace: (deckId: string) => request<Pace>('GET', `/me/pace?deck_id=${encodeURIComponent(deckId)}`),
  dismissSuggestion: (kind: 'lower' | 'raise') => request<null>('POST', '/me/pace/dismiss', { kind }),
  /** New words a day in a deck; a course level sets the whole course's (ADR 0028). */
  setDeckPace: (deckId: string, dailyNew: number) =>
    request<Pace>('PUT', `/decks/${encodeURIComponent(deckId)}/pace`, { daily_new: dailyNew }),
  /** More new words in a deck, today only. */
  addExtraWords: (deckId: string, words: number) =>
    request<Pace>('POST', `/decks/${encodeURIComponent(deckId)}/pace/extra`, { words }),
  groups: () => request<GroupSummary[]>('GET', '/groups'),
  createGroup: (name: string, nickname: string) => request<Group>('POST', '/groups', { name, nickname }),
  previewInvite: (code: string) => request<GroupPreview>('GET', `/groups/join/${encodeURIComponent(code)}`),
  joinGroup: (code: string, nickname: string) =>
    request<Group>('POST', `/groups/join/${encodeURIComponent(code)}`, { nickname }),
  board: (groupId: string, period: Period = 'week') =>
    request<Board>('GET', `/groups/${groupId}/board?period=${period}`),
  /** Leave; an owner names the member who takes the group over (ADR 0040). */
  leaveGroup: (groupId: string, successorId?: string) =>
    request<null>('DELETE', `/groups/${groupId}/members/me${successorId ? `?successor=${successorId}` : ''}`),
  renameGroup: (groupId: string, name: string) => request<Group>('PATCH', `/groups/${groupId}`, { name }),
  /** A new invite link; the old one stops working. */
  resetInvite: (groupId: string) => request<Group>('POST', `/groups/${groupId}/invite`),
  transferOwnership: (groupId: string, memberId: string) =>
    request<Group>('PUT', `/groups/${groupId}/owner`, { member_id: memberId }),
  deleteGroup: (groupId: string) => request<null>('DELETE', `/groups/${groupId}`),
  removeMember: (groupId: string, memberId: string) =>
    request<null>('DELETE', `/groups/${groupId}/members/${memberId}`),
  // Teachers' decks (ADR 0017): written by a group's owner, then given to the group.
  myDecks: () => request<TeacherDeck[]>('GET', '/decks/mine'),
  /** A new deck, mine until I give it to a group I own (ADR 0019). */
  createDeck: (title: string) => request<TeacherDeck>('POST', '/decks', { title }),
  library: () => request<Library>('GET', '/decks/library'),
  /** My deck, for good: its cards, the progress on them, its unfinished lessons (ADR 0019). */
  deleteDeck: (deckId: string) => request<null>('DELETE', `/decks/${deckId}`),
  /** Full cards from the words named, saved to the deck. */
  fillWords: (deckId: string, words: string[], level: string) =>
    request<GenerateResult>('POST', `/decks/${deckId}/words/fill`, { words, level }, 120_000),
  /** Cards for a topic: the AI chooses the words a learner needs for it (ADR 0019). */
  topicWords: (deckId: string, topic: string, count: number, level: string) =>
    request<GenerateResult>('POST', `/decks/${deckId}/words/topic`, { topic, count, level }, 120_000),
  /** One card filled in for the manual form, not saved. */
  suggestWord: (deckId: string, headword: string, level: string) =>
    request<SuggestedCard>('POST', `/decks/${deckId}/words/suggest`, { headword, level }, 60_000),
  teacherDeck: (deckId: string) => request<TeacherDeck>('GET', `/decks/${deckId}/edit`),
  renameDeck: (deckId: string, title: string) => request<TeacherDeck>('PATCH', `/decks/${deckId}`, { title }),
  addDeckWord: (deckId: string, word: DeckWordInput) => request<TeacherDeck>('POST', `/decks/${deckId}/words`, word),
  editDeckWord: (deckId: string, wordId: string, word: DeckWordInput) =>
    request<TeacherDeck>('PUT', `/decks/${deckId}/words/${wordId}`, word),
  removeDeckWord: (deckId: string, wordId: string) =>
    request<TeacherDeck>('DELETE', `/decks/${deckId}/words/${wordId}`),
  /** Drafts cards from a teacher's text into the deck (ADR 0018); a model call can take a minute. */
  /** `photos`: how many photos the text was read from (ADR 0029). Fifty cards can take minutes. */
  generateDeck: (deckId: string, text: string, count: number, level: string, photos = 0) =>
    request<GenerateResult>('POST', `/decks/${deckId}/generate`, { text, count, level, photos }, 240_000),
  /** Publish and give to a group I own; safe to repeat. */
  giveDeck: (deckId: string, groupId: string, dueOn: string | null = null) =>
    request<TeacherDeck>('POST', `/decks/${deckId}/publish`, { group_id: groupId, due_on: dueOn }),
  /** Change or remove a given deck's «Выучить к» (ADR 0028). */
  setDeckDue: (groupId: string, deckId: string, dueOn: string | null) =>
    request<TeacherDeck>('PATCH', `/groups/${groupId}/decks/${deckId}`, { due_on: dueOn }),
  takeBackDeck: (groupId: string, deckId: string) => request<null>('DELETE', `/groups/${groupId}/decks/${deckId}`),
  /** Deadline reminders (ADR 0031): the server's push key (null: off here), and this device. */
  pushKey: () => request<{ public_key: string | null }>('GET', '/push/key'),
  subscribePush: (subscription: PushSubscriptionJSON) => request<null>('POST', '/push/subscriptions', subscription),
  unsubscribePush: (endpoint: string) => request<null>('DELETE', '/push/subscriptions', { endpoint }),
  /** A group's spelling tests (ADR 0046). */
  groupTests: (groupId: string) => request<GroupTests>('GET', `/groups/${groupId}/tests`),
  testDetail: (groupId: string, deckId: string) => request<TestDetail>('GET', `/groups/${groupId}/tests/${deckId}`),
  testSetup: (groupId: string, deckId: string) =>
    request<TestSetupInfo>('GET', `/groups/${groupId}/tests/${deckId}/setup`),
  saveTest: (groupId: string, deckId: string, settings: TestSettings) =>
    request<TestSetupInfo>('PUT', `/groups/${groupId}/tests/${deckId}`, settings),
  openTest: (groupId: string, deckId: string, open: boolean) =>
    request<TestDetail>('PUT', `/groups/${groupId}/tests/${deckId}/open`, { open }),
  /** Starts, or returns the attempt already running with its saved order and deadline. */
  startTestAttempt: (groupId: string, deckId: string, kind: TestAttemptKind) =>
    request<TestAttempt>('POST', `/groups/${groupId}/tests/${deckId}/attempts`, { kind }, TEST_TIMEOUT_MS),
  testAttempt: (attemptId: string) => request<TestAttempt>('GET', `/test-attempts/${attemptId}`),
  // Safe to retry: the first answer to a question stands.
  answerTest: (attemptId: string, questionId: string, answer: string) =>
    request<TestAttempt>(
      'POST',
      `/test-attempts/${attemptId}/answers`,
      { question_id: questionId, answer },
      TEST_TIMEOUT_MS,
    ),
  // Safe to retry too: the same skip twice is one skip.
  skipTest: (attemptId: string, questionId: string, again: boolean) =>
    request<TestAttempt>(
      'POST',
      `/test-attempts/${attemptId}/skips`,
      { question_id: questionId, again },
      TEST_TIMEOUT_MS,
    ),
  /** Deletes the account: everything on our server and the login (ADR 0043). */
  deleteAccount: () => request<null>('DELETE', '/me'),
};

// Errors the learner can act on, by the server's error code.
const MESSAGES: Record<string, string> = {
  server_busy: 'Сейчас занимается очень много учеников. Попробуйте ещё раз через минуту.',
  account_delete_failed: 'Не удалось удалить аккаунт, ничего не изменилось. Попробуйте ещё раз через минуту.',
  reauth_required: 'Введите пароль ещё раз, чтобы удалить аккаунт.',
  nickname_taken: 'Это имя уже занято в группе — выберите другое.',
  invalid_nickname: 'Такое имя не подойдёт: только буквы, цифры, пробел и дефис.',
  invalid_group_name: 'Название: от 2 до 40 символов, без ссылок.',
  too_many_groups: 'Можно состоять не больше чем в 5 группах.',
  group_full: 'В этой группе уже 50 участников.',
  rate_limited: 'Слишком много попыток. Подождите минуту.',
  no_words: 'В этом тесте пока нет слов.',
  too_many_words: 'В колоде меньше слов, чем выбрано.',
  test_closed: 'Тест сейчас закрыт.',
  already_taken: 'Этот тест вы уже прошли.',
  test_running: 'Сначала закончите тест.',
  nothing_to_study: 'В этой колоде сейчас нечего учить: новые слова уже встречены, а повторений пока нет.',
  reviews_first: 'Сначала повторите слова, которые ждут, — новые вернутся сразу после этого.',
  word_in_deck: 'Это слово уже есть в наборе.',
  deck_full: 'В колоде может быть не больше 500 слов.',
  deck_empty: 'Сначала добавьте хотя бы одно слово.',
  course_word: 'Это слово из курса: его перевод и пример менять нельзя.',
  not_group_owner: 'Давать слова группе может только её владелец.',
  not_owner: 'Это может сделать только владелец группы.',
  not_allowed: 'В этой группе вам это не разрешено.',
  already_owner: 'Выберите другого участника.',
  generation_limit: 'На сегодня подбор слов исчерпан (20 раз в день). Попробуйте завтра.',
  generation_unavailable: 'Подбор слов пока не настроен на сервере.',
  generation_busy: 'Сервис подбора слов сейчас занят. Попробуйте через минуту.',
  generation_failed: 'Сервис подбора слов не ответил. Попробуйте ещё раз.',
  generation_too_long: 'Текст оказался слишком большим за один раз. Вставьте часть текста или выберите меньше слов.',
  generation_no_credits: 'На счёте сервиса подбора слов закончились средства.',
  generation_refused: 'Из этого текста не получилось составить карточки. Попробуйте другой отрывок.',
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
