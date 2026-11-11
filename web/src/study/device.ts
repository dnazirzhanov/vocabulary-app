import { api, ApiError } from '../lib/api.ts';
import { urlFor } from '../lib/audio.ts';
import { serverNow } from '../lib/clock.ts';
import type {
  AttemptResult,
  CardReport,
  DeckStats,
  Hint,
  Rating,
  Session,
  SpellingMode,
  SpellingSize,
  Summary,
} from '../lib/types.ts';
import type { AccountDb, KeptAnswer, OutboxOp } from '../local/db.ts';
import { deckCards } from '../local/myDecks.ts';
import { localDb } from '../local/session.ts';
import { ANSWERS_PER_PUSH, syncNow, syncSoon } from '../local/sync.ts';
import {
  answer as answerLesson,
  dayPlan,
  deckStats as statsOf,
  hint as hintIn,
  isOpen,
  metSince,
  missingFromPack,
  planHard,
  planPractice,
  planSpelling,
  planStudy,
  present,
  summarize,
  withExtra,
  type LocalLesson,
  type Response,
} from './lessons.ts';
import type { DayPlan, Step } from './plan.ts';
import { serializer } from './serial.ts';
import { learnerFrom, type Learner, type LocalAnswer } from './state.ts';
import { localDate } from './time.ts';

/**
 * Studying on this device (ADR 0062), in the same calls and shapes as the server's lesson routes:
 * lessons are planned, scheduled and checked here with no request between cards, and each answer
 * waits in the outbox until the server takes it. Where the browser keeps nothing (no IndexedDB),
 * the server's routes are used as before.
 */

const now = () => serverNow().getTime();
// Answers wait this long for the next ones, so a lesson sends a few batches, not one per card.
const ANSWERS_WAIT_MS = 15_000;
const FINISH_WAIT_MS = 3_000;
const FRESH_WAIT_MS = 2_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The learner as of the last pack plus the answers given since, kept in memory between calls.
let cached: { db: AccountDb; learner: Learner; lessons: Map<string, LocalLesson> } | null = null;

/** Forget the copy in memory: the pack changed, or a write failed. */
export const studyChanged = () => {
  cached = null;
};

// Study writes, one at a time (across tabs too); after each, the other tabs drop their copy.
const serial = serializer('study-writes');
const others = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('study-changed');
if (others) others.onmessage = () => studyChanged();

async function deviceId(db: AccountDb): Promise<string> {
  const kept = await db.get('study', 'device');
  if (kept && kept.key === 'device') return kept.id;
  const id = crypto.randomUUID();
  await db.put('study', { key: 'device', id });
  return id;
}

// Asked for (a deck's page, a change made online): the next sync cycle fetches the pack.
let packWanted = false;
export const takePackWanted = () => {
  const wanted = packWanted;
  packWanted = false;
  return wanted;
};

// A kept pack is fetched again after this long even with nothing finished here: another device
// may have studied, a teacher may have given a deck.
const PACK_FRESH_MS = 10 * 60_000;

/**
 * Brings the study pack up to date (after this device's changes are in, so it includes them), and
 * drops the answers it now holds. Only when it may have changed: none kept yet, a lesson just
 * finished here (`force`), or the kept one is old; the server builds it whole each time.
 */
export async function refreshPack(db: AccountDb, force = false): Promise<boolean> {
  // Fetching a pack is this device's contact: the server then refuses answers dated before it, so
  // never while one given here is still unsent.
  if ((await db.getAll('answers')).some((kept) => !kept.acked)) return false;
  const id = await deviceId(db);
  const kept = await db.get('study', 'pack');
  const fresh = kept?.key === 'pack' && Date.now() - Date.parse(kept.fetchedAt) < PACK_FRESH_MS;
  if (fresh && !force) return false;
  const sent = await api.studyPack(id, kept && kept.key === 'pack' ? kept.etag : null);
  if (!sent) {
    if (kept?.key === 'pack') await db.put('study', { ...kept, fetchedAt: new Date().toISOString() });
    return false;
  }
  const tx = db.transaction(['study', 'answers'], 'readwrite');
  await tx
    .objectStore('study')
    .put({ key: 'pack', pack: sent.pack, etag: sent.etag, fetchedAt: new Date().toISOString() });
  const answers = tx.objectStore('answers');
  for (const kept of await answers.getAll()) if (kept.acked) await answers.delete(kept.seq!);
  await tx.done;
  studyChanged();
  others?.postMessage('pack');
  return true;
}

/**
 * The learner, with `deckId` in it: a deck the kept pack doesn't have yet (just given to my
 * group, just made) brings a fresh pack first.
 */
async function loadWith(db: AccountDb, deckId: string | null) {
  const loaded = await load(db);
  if (deckId === null) return loaded;
  if (loaded.learner.decks.has(deckId) && (await unsentCards(db, loaded.learner, deckId)).length === 0) return loaded;
  packWanted = true;
  await syncNow();
  return load(db);
}

/** This device's cards of the deck the study pack lacks (only my own decks have any here). */
async function unsentCards(db: AccountDb, learner: Learner, deckId: string): Promise<string[]> {
  const cards = await deckCards(db, deckId).catch(() => []);
  return missingFromPack(
    learner,
    deckId,
    cards.map((card) => card.id),
  );
}

async function load(db: AccountDb) {
  if (cached?.db === db) return cached;
  let record = await db.get('study', 'pack');
  // Never studied on this device yet: the pack first (this needs the server, once).
  if (!record || record.key !== 'pack') {
    await refreshPack(db);
    record = await db.get('study', 'pack');
  }
  if (!record || record.key !== 'pack') throw new ApiError('network', 0, 'network_error', 'No study pack yet');
  const [answers, lessons] = await Promise.all([db.getAll('answers'), db.getAll('lessons')]);
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const learner = learnerFrom(
    record.pack,
    answers.map((kept) => kept.answer),
    (sessionId) => byId.get(sessionId)?.answers ?? [],
  );
  cached = { db, learner, lessons: byId };
  return cached;
}

const wireAnswer = (sent: LocalAnswer, device: string) => ({
  device_id: device,
  session_id: sent.sessionId,
  session_kind: sent.sessionKind,
  deck_id: sent.deckId,
  exercise_id: sent.exerciseId,
  word_id: sent.wordId,
  new: sent.new,
  hint: sent.hint,
  response:
    sent.rating !== null
      ? { kind: 'rating', rating: sent.rating }
      : { kind: 'spelling', answer: sent.answer ?? '', heard: sent.heard },
  answered_at: new Date(sent.answeredAt).toISOString(),
});

// Study operations name no deck or card in the outbox's indexes: deleting a deck never drops
// an answer waiting to be sent.
const outboxOp = (kind: OutboxOp['kind'], opId: string, payload: Record<string, unknown>): OutboxOp => ({
  opId,
  kind,
  payload,
  createdAt: new Date().toISOString(),
  status: 'pending',
  attempts: 0,
});

async function finishOp(db: AccountDb, lesson: LocalLesson, setAside: boolean): Promise<OutboxOp> {
  const opId = crypto.randomUUID();
  return outboxOp('study.finish', opId, {
    device_id: await deviceId(db),
    session_id: lesson.id,
    set_aside: setAside,
    finished_at: new Date(setAside ? lesson.setAsideAt! : lesson.finishedAt!).toISOString(),
  });
}

/** Writes a lesson and what goes with it in one transaction; on failure nothing is kept. */
async function save(db: AccountDb, lesson: LocalLesson, extra: { answer?: KeptAnswer; ops?: OutboxOp[] } = {}) {
  try {
    const tx = db.transaction(['lessons', 'answers', 'outbox'], 'readwrite');
    await tx.objectStore('lessons').put(lesson);
    if (extra.answer) await tx.objectStore('answers').add(extra.answer);
    for (const op of extra.ops ?? []) await tx.objectStore('outbox').add(op);
    await tx.done;
  } catch (error) {
    studyChanged();
    throw error;
  }
  cached?.lessons.set(lesson.id, lesson);
  others?.postMessage(lesson.id);
  // Answers go together, a lesson's end at once (then the pack follows).
  if (extra.ops?.length) {
    // A full batch waiting, or the lesson's end: now; otherwise the next answers may join them.
    const now = extra.ops.some((op) => op.kind === 'study.finish') || (await db.count('outbox')) >= ANSWERS_PER_PUSH;
    syncSoon(now ? 1000 : ANSWERS_WAIT_MS);
  }
}

function openOf(lessons: Map<string, LocalLesson>, spelling: boolean): LocalLesson | null {
  const open = [...lessons.values()]
    .filter((lesson) => isOpen(lesson) && (lesson.kind === 'spelling') === spelling)
    .sort((a, b) => b.startedAt - a.startedAt);
  return open[0] ?? null;
}

/** Leaves an unfinished lesson for another (ADR 0035); the server hears of it once it had answers. */
async function setAside(db: AccountDb, lesson: LocalLesson, at: number) {
  const left = { ...lesson, setAsideAt: at };
  await save(db, left, { ops: left.answers.length ? [await finishOp(db, left, true)] : [] });
}

function begin(...args: Parameters<typeof beginNow>): Promise<Session> {
  return serial(() => beginNow(...args));
}

async function beginNow(
  deckId: string,
  kind: LocalLesson['kind'],
  plan: (learner: Learner, moment: number) => Step[],
  resumes: (open: LocalLesson, learner: Learner) => boolean,
): Promise<Session> {
  const db = localDb()!;
  const { learner, lessons } = await loadWith(db, deckId);
  const moment = now();
  const existing = openOf(lessons, kind === 'spelling');
  if (existing) {
    if (resumes(existing, learner)) return present(learner, existing, moment);
    await setAside(db, existing, moment);
  }
  const lesson: LocalLesson = {
    id: crypto.randomUUID(),
    kind,
    deckId,
    steps: plan(learner, moment),
    results: [],
    answers: [],
    reviewed: [],
    startedAt: moment,
    finishedAt: null,
    setAsideAt: null,
  };
  await save(db, lesson);
  return present(learner, lesson, moment);
}

/** The deck the course is on: what «study» means without a deck. */
function currentLevel(learner: Learner): string {
  const levels = [...learner.decks.values()]
    .filter((deck) => deck.kind === 'course')
    .sort((a, b) => (a.level_order ?? 0) - (b.level_order ?? 0));
  const current = levels.find((deck) => deck.word_ids.some((wordId) => !learner.progress.has(wordId)));
  const deck = current ?? levels[levels.length - 1];
  if (!deck) throw new ApiError('http', 404, 'deck_not_found', 'deck_not_found');
  return deck.id;
}

function respond(sessionId: string, exerciseId: string, response: Response): Promise<AttemptResult> {
  return serial(() => respondNow(sessionId, exerciseId, response));
}

async function respondNow(sessionId: string, exerciseId: string, response: Response): Promise<AttemptResult> {
  const db = localDb()!;
  const { learner, lessons } = await load(db);
  const lesson = lessons.get(sessionId);
  if (!lesson) throw new ApiError('http', 404, 'session_not_found', 'session_not_found');
  const opId = crypto.randomUUID();
  const done = answerLesson(learner, lesson, exerciseId, response, now(), opId);
  if (!('sent' in done)) return done.result;
  await save(db, done.lesson, {
    answer: { opId, answer: done.sent, acked: false },
    ops: [outboxOp('study.answer', opId, wireAnswer(done.sent, await deviceId(db)))],
  });
  return done.result;
}

/**
 * The deck's spelling left unfinished, to resume; not once new words were met in the deck since,
 * when the main button starts afresh with them (ADR 0064).
 */
function pausedSpelling(learner: Learner, lessons: Map<string, LocalLesson>, deckId: string): LocalLesson | null {
  const open = openOf(lessons, true);
  return open && open.deckId === deckId && !metSince(learner, deckId, open.startedAt) ? open : null;
}

async function hintNow(sessionId: string, exerciseId: string, position: number): Promise<Hint> {
  const db = localDb()!;
  const { learner, lessons } = await load(db);
  const lesson = lessons.get(sessionId);
  if (!lesson) throw new ApiError('http', 404, 'session_not_found', 'session_not_found');
  const given = hintIn(learner, lesson, exerciseId, position);
  if (given.lesson !== lesson) await save(db, given.lesson);
  return given.hint;
}

async function completeNow(sessionId: string): Promise<Summary> {
  const db = localDb()!;
  const { learner, lessons } = await load(db);
  const lesson = lessons.get(sessionId);
  if (!lesson) throw new ApiError('http', 404, 'session_not_found', 'session_not_found');
  if (lesson.results.length < lesson.steps.length) {
    throw new ApiError('http', 409, 'session_incomplete', 'session_incomplete');
  }
  const moment = now();
  let finished = lesson;
  if (lesson.finishedAt === null) {
    finished = { ...lesson, finishedAt: moment };
    await save(db, finished, { ops: [await finishOp(db, finished, false)] });
    // Online, the lesson reaches the server before the next screen asks it for my progress;
    // offline this fails at once, and the outbox sends it later.
    await Promise.race([syncNow(), wait(FINISH_WAIT_MS)]);
  }
  return summarize(learner, finished, moment, pausedSpelling(learner, lessons, finished.deckId));
}

const local = () => localDb() !== null;

/** The lesson calls: on the device where it can keep things, else the server's as before. */
export const study = {
  async activeSession(): Promise<{ session: Session | null }> {
    if (!local()) return api.activeSession();
    const { learner, lessons } = await load(localDb()!);
    const open = openOf(lessons, false);
    return { session: open && present(learner, open, now()) };
  },

  async startStudySession(deckId: string | null): Promise<Session> {
    if (!local()) return api.startStudySession(deckId);
    const db = localDb()!;
    const { learner } = await load(db);
    const deck = deckId ?? currentLevel(learner);
    // Cards added here still not in the pack (no connection): said, rather than "nothing new".
    const unsent = await unsentCards(db, (await loadWith(db, deck)).learner, deck);
    return begin(
      deck,
      'study',
      (state, moment) => {
        try {
          return planStudy(state, deck, moment);
        } catch (error) {
          if (unsent.length && error instanceof ApiError && error.code === 'nothing_to_study') {
            throw new ApiError('http', 409, 'cards_not_synced', 'cards_not_synced');
          }
          throw error;
        }
      },
      (open) => deckId === null || open.deckId === deckId,
    );
  },

  /** A card said to be wrong: kept and sent with the other changes (works offline). */
  async reportCard(report: CardReport): Promise<void> {
    if (!local()) {
      await api.reportCard(report);
      return;
    }
    const payload = { ...report, reported_at: new Date(now()).toISOString() };
    await localDb()!.add('outbox', outboxOp('card.report', crypto.randomUUID(), payload));
    syncSoon(1000);
  },

  /** Practice on this device only: the screens offer it where there is one (`onDevice`). */
  onDevice: () => local(),

  /** Headwords (lowercase) of the words I already study: «Уже учите» in Reading Mode. */
  async learningHeadwords(): Promise<Set<string>> {
    if (!local()) return new Set();
    try {
      const { learner } = await load(localDb()!);
      const found = new Set<string>();
      for (const wordId of learner.progress.keys()) {
        const word = learner.words.get(wordId);
        if (word) found.add(word.headword.toLowerCase());
      }
      return found;
    } catch {
      return new Set(); // no study pack on this device yet
    }
  },

  async startPracticeSession(deckId: string, count: number | null): Promise<Session> {
    return begin(
      deckId,
      'hard',
      (state) => planPractice(state, deckId, count),
      () => false,
    );
  },

  async startHardSession(deckId: string): Promise<Session> {
    if (!local()) return api.startHardSession(deckId);
    return begin(
      deckId,
      'hard',
      (state) => planHard(state, deckId),
      (open) => open.deckId === deckId,
    );
  },

  async startSpellingSession(deckId: string, mode: SpellingMode = 'mix', size: SpellingSize = 10): Promise<Session> {
    if (!local()) return api.startSpellingSession(deckId, mode, size);
    return begin(
      deckId,
      'spelling',
      (state, moment) => planSpelling(state, deckId, mode, size, moment, Math.random),
      // Resumed unless new words were met in the deck since it was left: then afresh, with them
      // first (ADR 0064). The deck's page says the same (pausedSpelling).
      (open, learner) => mode === 'mix' && pausedSpelling(learner, new Map([[open.id, open]]), deckId) !== null,
    );
  },

  rateCard(sessionId: string, exerciseId: string, rating: Rating): Promise<AttemptResult> {
    if (!local()) return api.rateCard(sessionId, exerciseId, rating);
    return respond(sessionId, exerciseId, { kind: 'rating', rating });
  },

  spell(sessionId: string, exerciseId: string, answer: string, heard: boolean): Promise<AttemptResult> {
    if (!local()) return api.spell(sessionId, exerciseId, answer, heard);
    return respond(sessionId, exerciseId, { kind: 'spelling', answer, heard });
  },

  async hint(sessionId: string, exerciseId: string, position: number): Promise<Hint> {
    if (!local()) return api.hint(sessionId, exerciseId, position);
    return serial(() => hintNow(sessionId, exerciseId, position));
  },

  async completeSession(sessionId: string): Promise<Summary> {
    if (!local()) return api.completeSession(sessionId);
    return serial(() => completeNow(sessionId));
  },

  async deckStats(deckId: string): Promise<DeckStats> {
    if (!local()) return api.deckStats(deckId);
    // Online, up to date first (a group test, another device), but never kept waiting for it.
    if (navigator.onLine) await Promise.race([study.refresh().catch(() => undefined), wait(FRESH_WAIT_MS)]);
    const { learner, lessons } = await loadWith(localDb()!, deckId);
    return statsOf(learner, deckId, now(), pausedSpelling(learner, lessons, deckId));
  },

  /** Today in a deck, as its next lesson will be planned; null where nothing is kept. */
  async dayPlan(deckId: string): Promise<DayPlan | null> {
    if (!local()) return null;
    const { learner } = await loadWith(localDb()!, deckId);
    return learner.decks.has(deckId) ? dayPlan(learner, deckId, now()) : null;
  },

  /**
   * The pack up to date: a sync cycle sends what is waiting, then fetches it. After a change made
   * online that the pack holds (a deck's pace, extra words today), or to show a deck's page.
   */
  /** «Ещё N слов» (ADR 0028): kept here at once, sent with the other changes (works offline). */
  async addExtraWords(deckId: string, words: number): Promise<void> {
    if (!local()) {
      await api.addExtraWords(deckId, words);
      return;
    }
    const db = localDb()!;
    await serial(async () => {
      const { learner } = await load(db);
      const moment = now();
      const tx = db.transaction(['study', 'outbox'], 'readwrite');
      const record = await tx.objectStore('study').get('pack');
      if (record?.key === 'pack') {
        const pack = withExtra(record.pack, deckId, words, localDate(moment, learner.timeZone));
        await tx.objectStore('study').put({ ...record, pack });
      }
      const payload = { deck_id: deckId, words, added_at: new Date(moment).toISOString() };
      await tx.objectStore('outbox').add({ ...outboxOp('pace.extra', crypto.randomUUID(), payload), deckId });
      await tx.done;
      studyChanged();
      others?.postMessage('pack');
    });
    syncSoon(1000);
  },

  async refresh(): Promise<void> {
    if (!localDb()) return;
    packWanted = true;
    await syncNow();
  },
};

// --- audio kept ahead (owner's decision) -------------------------------------------------------

const AHEAD_DAYS = 7;
const NEW_AHEAD = 20;
const AUDIO_CACHE = 'audio-1';

/**
 * The words this device will likely play this week: course words due in the next 7 days, and the
 * next new words of each course level (only course words have recordings; others use the phone's
 * voice).
 */
export function wordsAhead(learner: Learner, moment: number): string[] {
  const course = [...learner.decks.values()].filter((deck) => deck.kind === 'course');
  const inCourse = new Set(course.flatMap((deck) => deck.word_ids));
  const until = moment + AHEAD_DAYS * 86_400_000;
  const due = [...learner.progress]
    .filter(([wordId, card]) => inCourse.has(wordId) && card.dueAt <= until)
    .map(([wordId]) => wordId);
  const fresh = course.flatMap((deck) =>
    deck.word_ids.filter((wordId) => !learner.progress.has(wordId)).slice(0, NEW_AHEAD),
  );
  return [...new Set([...due, ...fresh])];
}

/**
 * Fetches those recordings (word and example) that the service worker hasn't kept yet; it keeps
 * what passes through it. One at a time, after the sync, so it never competes with the app.
 */
export async function keepAudioAhead(db: AccountDb): Promise<number> {
  if (typeof caches === 'undefined' || !navigator.serviceWorker?.controller) return 0;
  const { learner } = await load(db);
  const cache = await caches.open(AUDIO_CACHE);
  let fetched = 0;
  for (const wordId of wordsAhead(learner, now())) {
    for (const url of [urlFor('words', wordId), urlFor('examples', wordId)]) {
      if (await cache.match(url, { ignoreVary: true })) continue;
      const response = await fetch(url).catch(() => null);
      if (!response) return fetched; // the connection went: next time
      fetched += 1;
    }
  }
  return fetched;
}
