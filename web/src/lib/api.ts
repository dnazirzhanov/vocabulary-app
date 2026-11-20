import type { OpResult, Pulled } from '../local/myDecks.ts';
import type { Pack } from '../study/state.ts';
import { setOffline } from '../local/online.ts';
import type { CardLanguage } from '../i18n/languages.ts';
import { accessToken, dropSession } from './auth.ts';
import { ApiError } from './apiError.ts';
import { syncWithServer } from './clock.ts';
import { apiBase } from './platform.ts';
import type {
  AttemptResult,
  Board,
  CardReport,
  Deck,
  DeckStats,
  DeckWord,
  DeckWordInput,
  GenerateResult,
  GlossaryEntry,
  Group,
  GroupPreview,
  GroupSummary,
  GroupTests,
  Hint,
  Knowledge,
  Library,
  Me,
  MeUpdate,
  OwnReading,
  OwnReadings,
  Pace,
  Period,
  Progress,
  PromiseInfo,
  Rating,
  GivenAnswers,
  GivenQuestion,
  GivenWord,
  ReadingAnswer,
  ReadingAssignment,
  ReadingCategory,
  ReportedCard,
  Session,
  SpellingMode,
  SpellingSize,
  SuggestedCard,
  Summary,
  TeacherDeck,
  TestAttempt,
  TestAttemptKind,
  TestDetail,
  TestSettings,
  TestSetupInfo,
} from './types.ts';
import { t } from '../i18n/index.ts';

export { ApiError };

const TIMEOUT_MS = 15_000;
const BUSY_RETRIES = 3;
// The server counts days (daily goal, streaks) in the learner's own time zone.
// A whole class starts a test within seconds (ADR 0046). Both requests are safe to repeat, and on a
// busy server a longer wait is kinder than an error in the middle of a timed test.
const TEST_TIMEOUT_MS = 30_000;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One request with the sign-in, the time zone and a time limit; notes the server's clock. */
async function send(
  method: Method,
  path: string,
  body: unknown,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        'X-Time-Zone': timeZone,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    setOffline(true);
    throw new ApiError('network', 0, 'network_error', 'The request did not reach the server');
  }
  setOffline(false);
  syncWithServer(response.headers.get('X-Server-Time'));
  if (response.status === 401) await dropSession();
  return response;
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  timeoutMs = TIMEOUT_MS,
  busyRetries = BUSY_RETRIES,
): Promise<T> {
  const response = await send(method, path, body, timeoutMs);
  const data: unknown = await response.json().catch(() => null);
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

/**
 * The study pack (ADR 0062) for this device; null when the one kept (`etag`) is still current.
 * Fetching it is the device's contact with the server.
 */
async function studyPack(deviceId: string, etag: string | null): Promise<{ pack: Pack; etag: string | null } | null> {
  const response = await send('GET', `/study/pack?device_id=${encodeURIComponent(deviceId)}`, undefined, 30_000, {
    ...(etag ? { 'If-None-Match': etag } : {}),
  });
  if (response.status === 304) return null;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError('http', response.status, error?.code ?? 'http_error', error?.message ?? response.statusText);
  }
  return { pack: data as Pack, etag: response.headers.get('ETag') };
}

export const api = {
  studyPack,
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
  /** Spelling cards for one set of a deck's words (ADR 0026, 0056): by default the main button's
   * mix of ten. */
  startSpellingSession: (deckId: string, mode: SpellingMode = 'mix', size: SpellingSize = 10) =>
    request<Session>('POST', '/sessions', { kind: 'spelling', deck_id: deckId, mode, size }),
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
  /** Bad wording in the app's text, told by someone who reads this language (ADR 0055). */
  reportWording: (text: string) => request<void>('POST', '/me/wording-reports', { text }),
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
  reportCard: (report: CardReport) => request<null>('POST', '/card-reports', report),
  courseReports: () => request<{ cards: ReportedCard[] }>('GET', '/card-reports'),
  deckReports: (deckId: string) =>
    request<{ cards: ReportedCard[] }>('GET', `/decks/${encodeURIComponent(deckId)}/card-reports`),
  resolveReports: (wordId: string) => request<null>('POST', `/card-reports/${encodeURIComponent(wordId)}/resolve`),
  addExtraWords: (deckId: string, words: number) =>
    request<Pace>('POST', `/decks/${encodeURIComponent(deckId)}/pace/extra`, { words }),
  /** My changes made on this device, in order; each applied once however often sent (ADR 0061). */
  syncPush: (ops: Record<string, unknown>[], pulledAt: string | null) =>
    request<{ results: OpResult[] }>('POST', '/sync/push', { ops, pulled_at: pulledAt }, 30_000),
  /** My decks changed since `cursor` (all of them from 0), and the deleted ones. */
  syncPull: (cursor: number, pulledAt: string | null) =>
    request<Pulled>(
      'GET',
      `/sync/decks?cursor=${cursor}${pulledAt ? `&pulled_at=${encodeURIComponent(pulledAt)}` : ''}`,
      undefined,
      30_000,
    ),
  groups: () => request<GroupSummary[]>('GET', '/groups'),
  createGroup: (name: string) => request<Group>('POST', '/groups', { name }),
  previewInvite: (code: string) => request<GroupPreview>('GET', `/groups/join/${encodeURIComponent(code)}`),
  joinGroup: (code: string) => request<Group>('POST', `/groups/join/${encodeURIComponent(code)}`),
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
  createDeck: (title: string, language?: CardLanguage) => request<TeacherDeck>('POST', '/decks', { title, language }),
  library: () => request<Library>('GET', '/decks/library'),
  // Reading Mode: texts people add themselves, and their categories (round 2).
  readings: () => request<OwnReadings>('GET', '/readings'),
  reading: (id: string) => request<OwnReading>('GET', `/readings/${id}`),
  addReading: (title: string, text: string, categoryId: string | null, topic: string | null = null) =>
    request<OwnReading>('POST', '/readings', { title, text, category_id: categoryId, topic }),
  changeReading: (id: string, change: { title?: string; category_id?: string | null }) =>
    request<OwnReading>('PATCH', `/readings/${id}`, change),
  deleteReading: (id: string) => request<null>('DELETE', `/readings/${id}`),
  /** My text's questions, as I leave them (changed, added, dropped). */
  setReadingQuestions: (id: string, questions: GivenQuestion[]) =>
    request<OwnReading>('PUT', `/readings/${id}/questions`, { questions }),
  redraftReading: (id: string) => request<OwnReading>('POST', `/readings/${id}/draft`),
  addReadingCategory: (name: string) => request<ReadingCategory>('POST', '/reading-categories', { name }),
  renameReadingCategory: (id: string, name: string) =>
    request<ReadingCategory>('PATCH', `/reading-categories/${id}`, { name }),
  deleteReadingCategory: (id: string) => request<null>('DELETE', `/reading-categories/${id}`),
  readingAnswers: (readingRef: string) =>
    request<ReadingAnswer[]>('GET', `/reading-answers?reading=${encodeURIComponent(readingRef)}`),
  answerCounts: () => request<Record<string, number>>('GET', '/reading-answers/counts'),
  /** A reading given to one of my groups, with its words and questions (round 2, D). */
  giveReading: (body: {
    group_id: string;
    reading_ref: string;
    words: GivenWord[];
    questions: GivenQuestion[];
    due_on: string | null;
  }) => request<ReadingAssignment>('POST', '/reading-assignments', body),
  readingAssignments: () => request<ReadingAssignment[]>('GET', '/reading-assignments'),
  readingAssignment: (id: string) => request<ReadingAssignment>('GET', `/reading-assignments/${id}`),
  takeBackReading: (id: string) => request<null>('DELETE', `/reading-assignments/${id}`),
  givenAnswers: (id: string) => request<GivenAnswers>('GET', `/reading-assignments/${id}/answers`),
  putAnswer: (questionRef: string, text: string, choice: number | null = null) =>
    request<null>('PUT', '/reading-answers', { question_ref: questionRef, text, ...(choice !== null && { choice }) }),
  /** My deck, for good: its cards, the progress on them, its unfinished lessons (ADR 0019). */
  deleteDeck: (deckId: string) => request<null>('DELETE', `/decks/${deckId}`),
  /** Full cards from the words named, saved to the deck. */
  fillWords: (deckId: string, words: string[], level: string, language: CardLanguage) =>
    request<GenerateResult>('POST', `/decks/${deckId}/words/fill`, { words, level, language }, 120_000),
  /** Cards for a topic: the AI chooses the words a learner needs for it (ADR 0019). */
  topicWords: (deckId: string, topic: string, count: number, level: string, language: CardLanguage) =>
    request<GenerateResult>('POST', `/decks/${deckId}/words/topic`, { topic, count, level, language }, 120_000),
  /** One card filled in for the manual form, not saved. */
  suggestWord: (deckId: string, headword: string, level: string, language: CardLanguage) =>
    request<SuggestedCard>('POST', `/decks/${deckId}/words/suggest`, { headword, level, language }, 60_000),
  teacherDeck: (deckId: string) => request<TeacherDeck>('GET', `/decks/${deckId}/edit`),
  renameDeck: (deckId: string, title: string) => request<TeacherDeck>('PATCH', `/decks/${deckId}`, { title }),
  addDeckWord: (deckId: string, word: DeckWordInput) => request<TeacherDeck>('POST', `/decks/${deckId}/words`, word),
  editDeckWord: (deckId: string, wordId: string, word: DeckWordInput) =>
    request<TeacherDeck>('PUT', `/decks/${deckId}/words/${wordId}`, word),
  removeDeckWord: (deckId: string, wordId: string) =>
    request<TeacherDeck>('DELETE', `/decks/${deckId}/words/${wordId}`),
  /** Drafts cards from a teacher's text into the deck (ADR 0018); a model call can take a minute. */
  /** `photos`: how many photos the text was read from (ADR 0029). Fifty cards can take minutes. */
  generateDeck: (deckId: string, text: string, count: number, level: string, language: CardLanguage, photos = 0) =>
    request<GenerateResult>('POST', `/decks/${deckId}/generate`, { text, count, level, language, photos }, 240_000),
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
  /** `at`: the word in that place (going back and forth); without it, the next word to do. */
  testAttempt: (attemptId: string, at?: number) =>
    request<TestAttempt>('GET', `/test-attempts/${attemptId}${at === undefined ? '' : `?at=${at}`}`),
  /** Saves a word's answer (null leaves it empty: skipped) until handed in, then shows the word at `at`. Safe to retry. */
  saveTestAnswer: (attemptId: string, questionId: string, answer: string | null, at: number) =>
    request<TestAttempt>(
      'PUT',
      `/test-attempts/${attemptId}/questions/${encodeURIComponent(questionId)}?at=${at}`,
      { answer },
      TEST_TIMEOUT_MS,
    ),
  /** Hands the attempt in. Safe to retry. */
  submitTest: (attemptId: string) =>
    request<TestAttempt>('POST', `/test-attempts/${attemptId}/submit`, undefined, TEST_TIMEOUT_MS),
  /** Deletes the account: everything on our server and the login (ADR 0043). */
  deleteAccount: () => request<null>('DELETE', '/me'),
  mentorHistory: () =>
    request<{ messages: Array<{ role: string; content: string; created_at: string }> }>('GET', '/mentor/history'),
  mentorClearHistory: () => request<null>('DELETE', '/mentor/history'),
  mentorChat: (message: string) =>
    request<{ reply: string; created_at: string; chats_remaining: number }>('POST', '/mentor/chat', { message }),
  mentorGoal: () => request<{ goal: string | null; daily_minutes: number | null }>('GET', '/mentor/goal'),
  mentorSetGoal: (goal: string, dailyMinutes: number | null) =>
    request<{ goal: string | null; daily_minutes: number | null }>('PUT', '/mentor/goal', {
      goal,
      daily_minutes: dailyMinutes,
    }),
  mentorStatus: () => request<{ chats_remaining: number; chats_limit: number }>('GET', '/mentor/status'),
  // Chats (ADR 0072).
  mentorConversations: () => request<MentorConversation[]>('GET', '/mentor/conversations'),
  mentorConversationMessages: (id: string) =>
    request<MentorMessage[]>('GET', `/mentor/conversations/${encodeURIComponent(id)}/messages`),
  mentorRenameConversation: (id: string, title: string) =>
    request<MentorConversation>('PATCH', `/mentor/conversations/${encodeURIComponent(id)}`, { title }),
  mentorDeleteConversation: (id: string) => request<null>('DELETE', `/mentor/conversations/${encodeURIComponent(id)}`),
  // The coach (ADR 0071).
  coach: () => request<Coach>('GET', '/mentor/coach'),
  coachSetGoal: (goal: {
    kind: CoachGoalKind;
    target?: string | null;
    deadline?: string | null;
    why?: string | null;
    start_level?: string | null;
  }) => request<Coach>('PUT', '/mentor/coach/goal', goal),
  coachStudyTimes: (minutes: number, weekdays: number[], preference?: 'morning' | 'day' | 'evening') => {
    const query = new URLSearchParams({ minutes: String(minutes) });
    for (const day of weekdays) query.append('weekdays', String(day));
    if (preference) query.set('preference', preference);
    return request<StudyTimeOption[]>('GET', `/mentor/coach/study-times?${query}`);
  },
  coachCommit: (weekdays: number[], startMinute: number, minutes: number) =>
    request<Coach>('PUT', '/mentor/coach/commitment', { weekdays, start_minute: startMinute, minutes }),
  coachDecide: (id: string, accept: boolean) =>
    request<Coach>('POST', `/mentor/coach/adjustments/${encodeURIComponent(id)}`, { accept }),
  scheduleList: () => request<{ events: WireScheduleEvent[] }>('GET', '/mentor/schedule'),
  scheduleCreate: (body: WireScheduleInput) => request<WireScheduleEvent>('POST', '/mentor/schedule', body),
  scheduleUpdate: (id: string, body: WireScheduleInput) =>
    request<WireScheduleEvent>('PUT', `/mentor/schedule/${id}`, body),
  /** «Только в этот день: не будет» (ADR 0074). */
  /** A «Начать» tapped, for knowing whether the mentor works (ADR 0078). */
  mentorStartTapped: (kind: MentorPlanItem['kind'], where: 'home' | 'chat' | 'panel') =>
    request<null>('POST', '/mentor/events', { name: 'start_tapped', kind, where }),
  scheduleSkip: (id: string, date: string) => request<null>('POST', `/mentor/schedule/${id}/skips`, { date }),
  scheduleUnskip: (id: string, date: string) => request<null>('DELETE', `/mentor/schedule/${id}/skips/${date}`),
  /** When today doesn't work (ADR 0074): the minimum, a later time, or tomorrow; null undoes it. */
  coachToday: (mode: 'minimum' | 'moved' | 'skip' | null, startMinute?: number) =>
    mode === null
      ? request<Coach>('DELETE', '/mentor/coach/today')
      : request<Coach>('PUT', '/mentor/coach/today', { mode, start_minute: startMinute }),
  /** What kind of day today is (ADR 0076); null clears it. */
  coachDayType: (type: 'study' | 'light' | 'weekend' | 'sick' | 'exam' | null) =>
    request<Coach>('PUT', '/mentor/coach/day-type', { type }),
  // What the mentor knows (ADR 0075).
  mentorMemory: () => request<MentorMemory>('GET', '/mentor/memory'),
  mentorAddFact: (kind: FactKind, text: string, source: 'chat' | 'user' = 'user') =>
    request<MentorMemory>('POST', '/mentor/memory/facts', { kind, text, source }),
  mentorChangeFact: (id: string, kind: FactKind, text: string) =>
    request<MentorMemory>('PUT', `/mentor/memory/facts/${encodeURIComponent(id)}`, { kind, text }),
  mentorForgetFact: (id: string) => request<MentorMemory>('DELETE', `/mentor/memory/facts/${encodeURIComponent(id)}`),
  /** Days off the promise (illness, a trip), from tomorrow until a date. */
  promisePause: (until: string) => request<unknown>('PUT', '/me/promise/pause', { until }),
  scheduleDelete: (id: string) => request<null>('DELETE', `/mentor/schedule/${id}`),
};

/** A card a mentor tool shows (ADR 0072). Nothing in one is saved until the learner taps it. */
export type MentorCard =
  | {
      type: 'activity';
      kind: 'vocab' | 'spelling' | 'reading' | 'writing' | 'speaking';
      deck_id: string | null;
      article_id: string | null;
      title: string | null;
      minutes: number | null;
      count: number | null;
      why: string | null;
    }
  | { type: 'busy'; busy_with: string | null; until: number | null }
  | {
      type: 'exception';
      kind: 'skip_day' | 'one_off' | 'pause';
      date: string;
      until?: string;
      title?: string;
      start_minute?: number;
      end_minute?: number;
      events?: { id: string; title: string }[];
    }
  | { type: 'replies'; replies: string[] }
  | { type: 'memory'; kind: FactKind; text: string }
  // The mentor's components (ADR 0077): the server fills in every fact.
  | {
      type: 'day';
      date: string;
      blocks: { title: string; kind: string; start_minute: number; end_minute: number }[];
      study_start: number | null;
      day_type: 'study' | 'light' | 'weekend' | 'sick' | 'exam' | null;
    }
  | { type: 'words'; words: { en: string; l1: string }[]; due: number }
  | { type: 'day_check'; current: 'study' | 'light' | 'weekend' | 'sick' | 'exam' | null }
  | { type: 'choice'; question: string; options: string[] }
  | { type: 'celebrate'; milestones: { kind: 'streak_weeks' | 'days_this_week' | 'words_known'; value: number }[] }
  | { type: 'done' }
  | {
      type: 'schedule';
      events: { title: string; kind: string; weekdays: number[]; start_minute: number; end_minute: number }[];
    }
  | {
      type: 'study_times';
      options: {
        weekdays: number[];
        start_minute: number;
        minutes: number;
        reasons: string[];
        kept?: number;
        tried?: number;
      }[];
    }
  | {
      type: 'goal';
      kind: CoachGoalKind;
      target: string | null;
      deadline: string | null;
      why: string | null;
      start_level: string | null;
      status: CoachStatus;
      hours_needed: number | null;
      weekly_minutes: number;
      minutes_a_day_needed: number | null;
      reached_by: string | null;
    }
  | {
      type: 'week';
      goal: { kind: string; target: string | null; deadline: string } | null;
      status: CoachStatus | null;
      targets: { skill: CoachSkill; planned: number; done: number }[];
      study_time: string | null;
      minutes: number | null;
      promised_days: number;
      studied_days: number;
    };

export type MentorToolName =
  | 'what_now'
  | 'suggest_activity'
  | 'get_week_plan'
  | 'propose_goal'
  | 'propose_schedule'
  | 'propose_study_times'
  | 'propose_exception'
  | 'offer_replies'
  | 'remember'
  | 'recall'
  | 'show';

export interface MentorToolEvent {
  id: string;
  name: MentorToolName;
  status: 'running' | 'done';
  card?: MentorCard | null;
}

export type MentorStreamEvent =
  | { conversation: { id: string; title: string }; delta?: never; done?: never; tool?: never }
  | { tool: MentorToolEvent; delta?: never; done?: never; conversation?: never }
  | { delta: string; done?: never; tool?: never; conversation?: never }
  | { done: true; delta?: never; tool?: never; conversation?: never; created_at: string; chats_remaining: number };

export interface MentorPlanItem {
  kind: 'vocab' | 'spelling' | 'reading' | 'writing' | 'speaking';
  title: string;
  count?: number;
  minutes: number;
  level?: string;
  deckId?: string;
  articleId?: string;
}

export interface MentorConversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface MentorMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  parts: { type: 'tool'; name: MentorToolName; card: MentorCard | null }[];
}

export type CoachGoalKind = 'ielts' | 'conversation' | 'travel' | 'business' | 'academic' | 'general';
export type CoachStatus = 'on_track' | 'tight' | 'not_possible' | 'open' | 'reached';
export type CoachSkill = 'words' | 'reading' | 'writing' | 'speaking';

export interface Coach {
  goal: {
    kind: CoachGoalKind;
    target: string | null;
    deadline: string | null;
    why: string | null;
    start_level: string | null;
  } | null;
  feasibility: {
    status: CoachStatus;
    hours_needed: number | null;
    weeks_left: number | null;
    weekly_minutes_needed: number | null;
    weekly_minutes: number;
    minutes_a_day_needed: number | null;
    reached_by: string | null;
  } | null;
  week_start: string;
  targets: { skill: CoachSkill; minutes: number; planned: number; done: number }[];
  behind: CoachSkill[];
  promised: boolean[];
  studied: boolean[];
  commitment: { weekdays: number[]; start_minute: number | null; minutes: number | null; pending_from: string | null };
  today: {
    override_mode: 'minimum' | 'moved' | 'skip' | null;
    override_start: number | null;
    studied: boolean;
    promised: boolean;
    missed_yesterday: boolean;
    day_type: 'study' | 'light' | 'weekend' | 'sick' | 'exam' | null;
  };
  adjustment: {
    id: string;
    kind: 'easier_minutes' | 'fewer_days' | 'move_time' | 'more_minutes' | 'behind';
    evidence: Record<string, number | null>;
    proposal: Record<string, number | null>;
  } | null;
}

export type FactKind = 'why' | 'likes' | 'dislikes' | 'constraint' | 'energy' | 'word' | 'other';
export const FACT_KINDS: FactKind[] = ['why', 'likes', 'dislikes', 'constraint', 'energy', 'word', 'other'];

export interface MentorMemory {
  facts: { id: string; kind: FactKind; text: string; source: 'chat' | 'user' | 'coach'; created_at: string }[];
  timeline: { at: string; kind: string; note: Record<string, string | number | null> }[];
}

export interface WireScheduleInput {
  title: string;
  kind: string;
  weekdays: number;
  start_minute: number;
  end_minute: number;
  on_date?: string | null;
}

export interface WireScheduleEvent extends WireScheduleInput {
  id: string;
  on_date: string | null;
  skipped: string[];
}

export interface StudyTimeOption {
  weekdays: number[];
  start_minute: number;
  minutes: number;
  reasons: ('free' | 'habit' | 'preferred' | 'after_block' | 'works')[];
  kept?: number;
  tried?: number;
}

/** Streams mentor chat reply as SSE events. Caller should handle ApiError for 403/429. */
export async function* mentorChatStream(
  message: string,
  plan?: MentorPlanItem[],
  tip_id?: string,
  chat?: { conversationId?: string | null; newConversation?: boolean },
): AsyncGenerator<MentorStreamEvent> {
  const response = await send(
    'POST',
    '/mentor/chat/stream',
    {
      message,
      plan,
      tip_id,
      conversation_id: chat?.conversationId ?? undefined,
      new_conversation: chat?.newConversation ?? undefined,
    },
    180_000,
  );
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError('http', response.status, error?.code ?? 'http_error', error?.message ?? response.statusText);
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const raw of events) {
      const line = raw.trim();
      if (!line.startsWith('data: ')) continue;
      yield JSON.parse(line.slice(6)) as MentorStreamEvent;
    }
  }
}

// Errors the learner can act on, by the server's error code.
const MESSAGES: Record<string, string> = {
  server_busy: t.aLotOfStudentsAreStudying,
  account_delete_failed: t.couldnTDeleteTheAccountAnd,
  reauth_required: t.enterYourPasswordAgainToDelete,
  invalid_name: t.thatNameWonTWorkOnly,
  name_required: t.nameRequired,
  invalid_group_name: t.name2To40CharactersNo,
  too_many_wording_reports: t.tooManyAttemptsWaitAMinute,
  too_many_groups: t.youCanBeInAtMost,
  group_full: t.thisGroupAlreadyHas50Members,
  rate_limited: t.tooManyAttemptsWaitAMinute,
  no_words: t.thisTestHasNoWordsYet,
  too_many_words: t.theDeckHasFewerWordsThan,
  test_closed: t.theTestIsClosedRightNow,
  already_taken: t.youVeAlreadyTakenThisTest,
  test_running: t.finishTheTestFirst,
  nothing_to_study: t.nothingToStudyInThisDeck,
  cards_not_synced: t.cardsNotSynced,
  reviews_first: t.firstReviewTheWordsThatAre,
  too_many_decks: t.tooManyDecks,
  reading_too_long: t.readingTooLong,
  answer_too_short: t.answerTooShort,
  answer_too_long: t.answerTooLong,
  answer_final: t.answerFinal,
  answer_no_choice: t.answerNoChoice,
  reading_empty: t.readingEmpty,
  category_exists: t.categoryExists,
  too_many_readings: t.tooManyReadings,
  too_many_categories: t.tooManyCategories,
  invalid_request: t.checkTheCard,
  word_in_deck: t.thisWordIsAlreadyInThe,
  deck_full: t.aDeckCanHaveAtMost,
  deck_empty: t.firstAddAtLeastOneWord,
  course_word: t.thisWordIsFromTheCourse,
  not_group_owner: t.onlyTheGroupSOwnerCan,
  not_owner: t.onlyOwnerCanDoThat,
  not_allowed: t.youArenTAllowedToDo,
  too_many_reports: t.tooManyReports,
  name_not_allowed: t.nameNotAllowed,
  already_owner: t.chooseAnotherMember,
  generation_limit: t.wordPickingIsUsedUpFor,
  generation_unavailable: t.wordPickingIsnTSetUp,
  generation_busy: t.theWordPickingServiceIsBusy,
  generation_failed: t.theWordPickingServiceDidnT,
  generation_too_long: t.theTextIsTooLongFor,
  generation_no_credits: t.theWordPickingServiceHasRun,
  generation_refused: t.couldnTMakeCardsFromThis,
};

/** Learner-facing message for a failed request. Never shown for a wrong answer. */
export function describeError(error: unknown): string {
  // The server's refusals, and the same ones made on this device first (local/myDecks.ts).
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof ApiError && error.kind === 'network') {
    return t.noConnectionToTheServerCheck;
  }
  if (error instanceof ApiError && error.status >= 500) {
    return t.theServerIsnTRespondingTry;
  }
  return t.somethingWentWrongTryAgain;
}
