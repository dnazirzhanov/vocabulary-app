import { tokenize } from '../lib/tokens.ts';

/**
 * An article paragraph as the reader draws it: words (tappable, with their place in the text) and
 * the text between them, grouped into highlights. Pure, so it is tested without a browser.
 */

export interface Piece {
  text: string;
  /** A word form (lowercase), null for spaces and punctuation. */
  key: string | null;
  start: number;
  end: number;
}

export function pieces(text: string): Piece[] {
  let at = 0;
  return tokenize(text).map((part) => {
    const piece = { text: part.text, key: part.key, start: at, end: at + part.text.length };
    at = piece.end;
    return piece;
  });
}

/** A place in the article: paragraph index and character offset in it. */
export interface Point {
  p: number;
  o: number;
}

export interface Highlight {
  id: string;
  from: Point;
  to: Point;
  /** The words highlighted, kept for the notes list. */
  quote: string;
  note: string;
  createdAt: string;
}

const before = (a: Point, b: Point) => a.p < b.p || (a.p === b.p && a.o < b.o);

/** The part of paragraph `p` a highlight covers, as [start, end), or null. */
export function coverage(highlight: Highlight, p: number, length: number): [number, number] | null {
  if (p < highlight.from.p || p > highlight.to.p) return null;
  const start = p === highlight.from.p ? highlight.from.o : 0;
  const end = p === highlight.to.p ? highlight.to.o : length;
  return end > start ? [start, end] : null;
}

/** A paragraph's pieces in runs: consecutive pieces under one highlight go together. */
export interface Run {
  highlight: string | null;
  pieces: Piece[];
}

export function runs(text: string, p: number, highlights: readonly Highlight[]): Run[] {
  const spans = highlights
    .map((highlight) => ({ id: highlight.id, range: coverage(highlight, p, text.length) }))
    .filter((item): item is { id: string; range: [number, number] } => item.range !== null);
  const result: Run[] = [];
  for (const piece of pieces(text)) {
    // Highlights snap to whole words, so a piece is wholly inside one or outside all.
    const owner = spans.find(({ range: [start, end] }) => piece.start >= start && piece.end <= end)?.id ?? null;
    const last = result[result.length - 1];
    if (last && last.highlight === owner) last.pieces.push(piece);
    else result.push({ highlight: owner, pieces: [piece] });
  }
  return result;
}

/**
 * A selection made whole: from the start of the first word it touches to the end of the last, so a
 * highlight never cuts a word. Null when it touches no word.
 */
export function snap(body: readonly string[], from: Point, to: Point): { from: Point; to: Point } | null {
  if (before(to, from)) [from, to] = [to, from];
  let start: Point | null = null;
  let end: Point | null = null;
  for (let p = from.p; p <= to.p && p < body.length; p += 1) {
    const lo = p === from.p ? from.o : 0;
    const hi = p === to.p ? to.o : body[p].length;
    for (const piece of pieces(body[p])) {
      if (!piece.key || piece.end <= lo || piece.start >= hi) continue;
      start ??= { p, o: piece.start };
      end = { p, o: piece.end };
    }
  }
  return start && end ? { from: start, to: end } : null;
}

/** The text between two points, paragraphs joined by a space. */
export function quoteOf(body: readonly string[], from: Point, to: Point): string {
  const parts: string[] = [];
  for (let p = from.p; p <= to.p; p += 1) {
    parts.push(body[p].slice(p === from.p ? from.o : 0, p === to.p ? to.o : undefined));
  }
  return parts.join(' ');
}

/** The sentence a word at `offset` is in: what a saved card keeps as its example. */
export function sentenceAt(text: string, offset: number, max = 300): string {
  const ends = /[.!?]["')\]]?(?=\s|$)/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(ends)) {
    const stop = match.index + match[0].length;
    if (stop <= offset) start = stop;
    else {
      end = stop;
      break;
    }
  }
  const sentence = text.slice(start, end).trim();
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}

/** Does a highlight contain this place? */
export const contains = (highlight: Highlight, point: Point) =>
  !before(point, highlight.from) && before(point, highlight.to);

/** An answer is at most this many words, whatever a question allows (the owner's limit). */
export const MAX_ANSWER_WORDS = 500;

/** Text cut after its `max`-th word: the box never holds more than an answer may have. */
export function capWords(text: string, max = MAX_ANSWER_WORDS): string {
  let words = 0;
  let at = 0;
  for (const part of tokenize(text)) {
    if (part.key && (words += 1) > max) return text.slice(0, at).trimEnd();
    at += part.text.length;
  }
  return text;
}
