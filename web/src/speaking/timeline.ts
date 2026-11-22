/**
 * The answer as it was spoken: its words, with each pause and each «эм» put where it happened.
 * Pauses come from the fluency evidence (found in the audio, on the recording's clock); words from
 * Whisper's transcript, with its own times.
 */

export interface TimedWord {
  word: string;
  start_ms: number;
  end_ms: number;
}

export interface EvidencePause {
  start_ms: number;
  ms: number;
  kind: 'silent' | 'filled';
  inside_phrase: boolean;
}

export type Piece =
  { kind: 'word'; text: string } | { kind: 'filler'; text: string } | { kind: 'pause'; ms: number; inside: boolean };

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'eh', 'hmm', 'hm', 'mm', 'mhm']);

export const isFiller = (word: string) =>
  FILLERS.has(
    word
      .trim()
      .replace(/^[.,!?;:…\-—"']+|[.,!?;:…\-—"']+$/g, '')
      .toLowerCase(),
  );

/** Pauses from evidence, keeping only well-formed ones (old assessments have none). */
export function pausesOf(evidence: unknown): EvidencePause[] {
  const list = (evidence as { pauses?: unknown } | undefined)?.pauses;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p): p is EvidencePause =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as EvidencePause).start_ms === 'number' &&
      typeof (p as EvidencePause).ms === 'number' &&
      ((p as EvidencePause).kind === 'silent' || (p as EvidencePause).kind === 'filled'),
  );
}

/**
 * Words and markers in spoken order. A filled pause that Whisper also wrote down («um») shows once,
 * as the transcript's own word.
 */
export function timeline(words: TimedWord[], pauses: EvidencePause[]): Piece[] {
  const spokenFillers = words.filter((w) => isFiller(w.word));
  const extra = pauses
    .filter(
      (p) =>
        p.kind === 'silent' ||
        !spokenFillers.some((w) => w.start_ms - 150 <= p.start_ms && p.start_ms <= w.end_ms + 150),
    )
    .sort((a, b) => a.start_ms - b.start_ms);

  const out: Piece[] = [];
  let next = 0;
  const flushUntil = (ms: number) => {
    while (next < extra.length && extra[next].start_ms <= ms) {
      const p = extra[next++];
      out.push(
        p.kind === 'silent' ? { kind: 'pause', ms: p.ms, inside: p.inside_phrase } : { kind: 'filler', text: '' },
      );
    }
  };
  for (const w of words) {
    flushUntil(w.start_ms);
    out.push(isFiller(w.word) ? { kind: 'filler', text: w.word.trim() } : { kind: 'word', text: w.word.trim() });
  }
  flushUntil(Number.POSITIVE_INFINITY);
  return out;
}

/** «1,4 с» in the learner's interface language: one decimal, the locale's own separator. */
export function seconds(ms: number, locale?: string): string {
  return (ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
