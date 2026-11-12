import { api } from '../lib/api.ts';
import { countWords } from '../lib/tokens.ts';
import type { ReadingAnswer, ReadingQuestion } from '../lib/types.ts';
import { readSnapshot, type OutboxOp } from '../local/db.ts';
import { localDb } from '../local/session.ts';
import { syncSoon } from '../local/sync.ts';

/**
 * Answers to a text's comprehension questions (round 2, C). Written on the device: kept here at
 * once (so they show offline and after a reload) and sent through the outbox (`reading.answer`).
 */

const key = (readingRef: string) => `answers:${readingRef}`;

/** The newer of two answers to the same question. */
const newer = (a: ReadingAnswer | undefined, b: ReadingAnswer) => (a && a.updated_at > b.updated_at ? a : b);

function byQuestion(...lists: ReadingAnswer[][]): Record<string, ReadingAnswer> {
  const found: Record<string, ReadingAnswer> = {};
  for (const list of lists) for (const one of list) found[one.question_ref] = newer(found[one.question_ref], one);
  return found;
}

/** Of two sets of answers, each question's newer one. */
export const mergeAnswers = (a: Record<string, ReadingAnswer>, b: Record<string, ReadingAnswer>) =>
  byQuestion(Object.values(a), Object.values(b));

/** My answers to one text as this device has them: at once, before the server answers. */
export async function keptAnswers(readingRef: string): Promise<Record<string, ReadingAnswer>> {
  const db = localDb();
  if (!db) return {};
  return byQuestion((await readSnapshot<ReadingAnswer[]>(db, key(readingRef)).catch(() => null))?.value ?? []);
}

/**
 * My answers to one text: the server's, with any written here more recently (not sent yet). The
 * device's copy is read again after the server answers, so an answer written meanwhile stays.
 */
export async function loadAnswers(readingRef: string): Promise<Record<string, ReadingAnswer>> {
  let server: ReadingAnswer[];
  try {
    server = await api.readingAnswers(readingRef);
  } catch {
    // Offline, or the server busy: as this device has them.
    return keptAnswers(readingRef);
  }
  const db = localDb();
  if (!db) return byQuestion(server);
  const tx = db.transaction('snapshots', 'readwrite');
  const kept = ((await tx.store.get(key(readingRef)))?.value as ReadingAnswer[] | undefined) ?? [];
  const merged = byQuestion(server, kept);
  await tx.store.put({ key: key(readingRef), value: Object.values(merged), savedAt: new Date().toISOString() });
  await tx.done;
  return merged;
}

/**
 * Sends an answer (once a connection allows) and keeps it here at once: open, its text; to a
 * question with options, the one picked (`choice`), right or wrong at once, offline too.
 */
export async function saveAnswer(
  readingRef: string,
  question: ReadingQuestion,
  text: string,
  choice: number | null = null,
): Promise<ReadingAnswer> {
  const now = new Date().toISOString();
  const picked = choice !== null && question.options ? question.options[choice] : null;
  const answer: ReadingAnswer = {
    question_ref: question.id,
    question_text: question.q,
    text: picked ?? text.trim(),
    words: picked ? 0 : countWords(text),
    sent_at: now,
    updated_at: now,
    choice,
    correct: choice === null ? null : choice === question.answer,
  };
  const db = localDb();
  if (!db) {
    await api.putAnswer(question.id, picked ? '' : answer.text, choice);
    return answer;
  }
  const tx = db.transaction(['outbox', 'snapshots'], 'readwrite');
  const item: OutboxOp = {
    opId: crypto.randomUUID(),
    kind: 'reading.answer',
    payload:
      choice === null
        ? { question_ref: question.id, text: answer.text, answered_at: now }
        : { question_ref: question.id, choice, answered_at: now },
    createdAt: now,
    status: 'pending',
    attempts: 0,
  };
  await tx.objectStore('outbox').add(item);
  const kept = ((await tx.objectStore('snapshots').get(key(readingRef)))?.value as ReadingAnswer[] | undefined) ?? [];
  const earlier = kept.find((one) => one.question_ref === question.id);
  const saved = earlier ? { ...answer, sent_at: earlier.sent_at } : answer;
  await tx
    .objectStore('snapshots')
    .put({ key: key(readingRef), value: Object.values(byQuestion(kept, [saved])), savedAt: now });
  await tx.done;
  syncSoon();
  return saved;
}

/**
 * How many questions of each text I have answered: the server's count, or this device's when it
 * holds more (answers not sent yet, or no connection).
 */
export async function loadAnswerCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = await api.answerCounts().catch(() => ({}));
  const db = localDb();
  if (!db) return counts;
  for (const kept of await db.getAll('snapshots').catch(() => [])) {
    if (!kept.key.startsWith('answers:')) continue;
    const readingRef = kept.key.slice('answers:'.length);
    counts[readingRef] = Math.max(counts[readingRef] ?? 0, (kept.value as ReadingAnswer[]).length);
  }
  return counts;
}
