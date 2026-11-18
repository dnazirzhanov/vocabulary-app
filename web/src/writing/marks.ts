import type { CriterionName, Evaluation, Mistake } from './api.ts';

/** Which category a mistake belongs under. */
export const MISTAKE_HOME: Record<Mistake['type'], CriterionName> = {
  grammar: 'grammar',
  spelling: 'mechanics',
  punctuation: 'mechanics',
  word_choice: 'vocabulary',
};

/** One numbered fix: a mistake to correct, or a word that could be better. */
export interface Fix {
  /** 1, 2, 3… in the order they appear in the answer; fixes not found in it come last. */
  n: number;
  kind: 'mistake' | 'tip';
  home: CriterionName;
  original: string;
  replacement: string;
  why: string;
  /** Where `original` sits in the answer; null when the model quoted something not in it. */
  start: number | null;
  end: number | null;
  /** The rest of its sentence, for showing the fix in context ('' when not found). */
  before: string;
  after: string;
}

/** A run of the answer: plain text, or a highlighted fix. */
export type Segment = { text: string; fix?: Fix };

const CONTEXT = 90; // characters of context on each side, at most

function locate(answer: string, needle: string, taken: [number, number][]): number | null {
  if (!needle) return null;
  const free = (at: number) => taken.every(([s, e]) => at + needle.length <= s || at >= e);
  for (const hay of [answer, answer.toLowerCase()]) {
    const n = hay === answer ? needle : needle.toLowerCase();
    for (let at = hay.indexOf(n); at !== -1; at = hay.indexOf(n, at + 1)) {
      if (free(at)) return at;
    }
  }
  return null;
}

/** The sentence around [start, end): from the last sentence end before it to the next one after it. */
function sentence(answer: string, start: number, end: number): { before: string; after: string } {
  let from = start;
  while (from > 0 && !/[.!?\n]/.test(answer[from - 1])) from -= 1;
  // Stops at once when the fix itself ends the sentence ("car." → "a car.").
  let to = end;
  while (to < answer.length && answer[to] !== '\n' && !/[.!?]/.test(answer[to - 1] ?? '')) to += 1;
  let before = answer.slice(from, start).trimStart();
  let after = answer.slice(end, to).trimEnd();
  if (before.length > CONTEXT) before = '…' + before.slice(-CONTEXT).replace(/^\S*\s/, '');
  if (after.length > CONTEXT) after = after.slice(0, CONTEXT).replace(/\s\S*$/, '') + '…';
  return { before, after };
}

/** Every fix the evaluation gives, numbered in reading order and placed in the answer. */
export function collectFixes(answer: string, ev: Pick<Evaluation, 'corrections' | 'vocabulary'>): Fix[] {
  const raw = [
    ...ev.corrections.map((c) => ({
      kind: 'mistake' as const,
      home: MISTAKE_HOME[c.type],
      original: c.original.trim(),
      replacement: c.corrected.trim(),
      why: c.explanation,
    })),
    ...ev.vocabulary.map((v) => ({
      kind: 'tip' as const,
      home: 'vocabulary' as CriterionName,
      original: v.original.trim(),
      replacement: v.suggestion.trim(),
      why: v.note,
    })),
  ];
  const taken: [number, number][] = [];
  const placed = raw.map((f, i) => {
    const start = locate(answer, f.original, taken);
    if (start === null) return { ...f, i, start: null, end: null, before: '', after: '' };
    const end = start + f.original.length;
    taken.push([start, end]);
    return { ...f, i, start, end, ...sentence(answer, start, end) };
  });
  placed.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.i - b.i);
  return placed.map(({ kind, home, original, replacement, why, start, end, before, after }, k) => ({
    n: k + 1,
    kind,
    home,
    original,
    replacement,
    why,
    start,
    end,
    before,
    after,
  }));
}

/** The answer cut into plain runs and highlighted fixes, in order. */
export function segments(answer: string, fixes: Fix[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const fix of fixes) {
    if (fix.start === null || fix.end === null) continue;
    if (fix.start > at) out.push({ text: answer.slice(at, fix.start) });
    out.push({ text: answer.slice(fix.start, fix.end), fix });
    at = fix.end;
  }
  if (at < answer.length) out.push({ text: answer.slice(at) });
  return out;
}
