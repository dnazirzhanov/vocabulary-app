/**
 * A group task's material (ADR 0096): what a teacher can link, kind by kind, and what each link
 * opens. The lists come from the sections' own endpoints.
 */
import { api, request } from '../lib/api.ts';
import { listExercises } from '../shadowing/api.ts';
import { levelName } from '../shadowing/levels.ts';
import { listQuestions as speakingQuestions } from '../speaking/api.ts';
import type { WritingQuestion } from '../writing/api.ts';
import type { LinkKind } from './api.ts';

export const LINK_KINDS: readonly LinkKind[] = ['deck', 'reading', 'writing', 'speaking', 'shadowing'];

export interface Pickable {
  ref: string;
  title: string;
  /** A topic or a level, under the title. */
  note: string | null;
}

export async function pickable(kind: LinkKind): Promise<Pickable[]> {
  if (kind === 'deck') {
    const library = await api.library();
    return library.mine.map((d) => ({ ref: d.id, title: d.title, note: null }));
  }
  if (kind === 'reading') {
    // Loaded only here: the task row imports this file, and the first screen shouldn't load Reading.
    const { loadIndex, loadOwn } = await import('../reading/articles.ts');
    const [articles, own] = await Promise.all([loadIndex(), loadOwn().catch(() => null)]);
    return [
      ...(own?.readings ?? []).map((r) => ({ ref: `reading:${r.id}`, title: r.title, note: null })),
      ...articles.map((a) => ({ ref: `library:${a.id}`, title: a.title, note: a.level ?? null })),
    ];
  }
  if (kind === 'writing') {
    const questions = await request<WritingQuestion[]>('GET', '/writing/questions');
    return questions.map((q) => ({ ref: q.id, title: q.title, note: q.topic }));
  }
  if (kind === 'speaking') {
    const questions = await speakingQuestions();
    return questions.map((q) => ({ ref: q.id, title: q.text, note: q.topic }));
  }
  const exercises = await listExercises();
  return exercises.map((e) => ({ ref: e.id, title: e.title, note: levelName(e.difficulty) }));
}
