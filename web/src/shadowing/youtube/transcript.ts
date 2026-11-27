/**
 * A video's text as pasted by the learner, turned into sentences with their times (ADR 0097).
 *
 * Accepted: what YouTube's «Show transcript» panel copies (a time line such as `0:03` or
 * `1:02:03`, then the words; or both on one line; chapter headings in between), and `.srt` /
 * `.vtt` subtitles. Nothing here talks to YouTube: the text is the learner's paste.
 */

export interface Cue {
  start_ms: number;
  /** Known for subtitle files; a pasted panel gives only where each line starts. */
  end_ms: number | null;
  text: string;
}

export interface Sentence {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** `0:03`, `12:45`, `1:02:03`, with an optional `.500` / `,500` part. */
const TIME = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;
const RANGE = /^\s*(\S+)\s*-->\s*(\S+)/;
/** «[Music]», «(applause)», «♪»: sounds, not words to say. */
const SOUND = /\[[^\]]*\]|\([^)]*\)|♪+/g;

function timeOf(text: string): number | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  const [, h, min, s, frac] = m;
  if (Number(s) > 59 || (h !== undefined && Number(min) > 59)) return null;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(s)) * 1000 + ms;
}

function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, '') // VTT's inline tags
    .replace(SOUND, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Subtitle files: `start --> end` lines, each followed by its words. */
function parseSubtitles(lines: string[]): Cue[] {
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = RANGE.exec(lines[i]);
    if (!m) continue;
    const start = timeOf(m[1]);
    const end = timeOf(m[2]);
    if (start === null || end === null) continue;
    const words: string[] = [];
    for (i += 1; i < lines.length && lines[i].trim() !== '' && !RANGE.exec(lines[i]); i += 1) words.push(lines[i]);
    i -= 1;
    const text = clean(words.join(' '));
    if (text) cues.push({ start_ms: start, end_ms: end, text });
  }
  // Auto-generated VTT repeats each line as the next one rolls in: keep every line once.
  return cues.filter((cue, index) => index === 0 || cue.text !== cues[index - 1].text);
}

/** YouTube's panel: a time, then the words (on the same line or the next ones). */
function timeAtStart(line: string): { at: number; rest: string } | null {
  const alone = timeOf(line);
  if (alone !== null) return { at: alone, rest: '' };
  const leading = /^(\d{1,2}(?::\d{2}){1,2})\s+(.+)$/.exec(line);
  const at = leading ? timeOf(leading[1]) : null;
  return at === null || !leading ? null : { at, rest: leading[2] };
}

function parsePanel(raw: string[]): Cue[] {
  const lines = raw.map((line) => line.trim()).filter(Boolean);
  const cues: Cue[] = [];
  let current: Cue | null = null;
  lines.forEach((line, index) => {
    const timed = timeAtStart(line);
    if (timed) {
      if (current?.text) cues.push(current);
      current = { start_ms: timed.at, end_ms: null, text: clean(timed.rest) };
      return;
    }
    // Words before any time (the video's title), or a chapter's name: a line that comes after a
    // line's words and right before the next time. The panel copies each line's words as one.
    if (current === null) return;
    const nextIsTime = index + 1 < lines.length && timeAtStart(lines[index + 1])?.rest === '';
    if (current.text && nextIsTime) return;
    current.text = clean(`${current.text} ${line}`);
  });
  if (current !== null && (current as Cue).text) cues.push(current);
  return cues;
}

/** The pasted text's lines with their times; empty when it has no times at all. */
export function parseTranscript(pasted: string): Cue[] {
  const lines = pasted
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split('\n');
  const cues = lines.some((line) => RANGE.test(line)) ? parseSubtitles(lines) : parsePanel(lines);
  return cues.filter((cue) => cue.text.length > 0).sort((a, b) => a.start_ms - b.start_ms);
}

interface Word {
  text: string;
  at: number;
}

/** About how long a word takes to say, for the last line, whose end nobody wrote down. */
const MS_PER_WORD = 400;
const MIN_LAST_MS = 1500;
/** Without punctuation (automatic captions): a pause this long ends a sentence. */
const PAUSE_MS = 700;
/** No sentence longer than this, to stay one breath for a child. */
const MAX_MS = 10_000;
const MAX_WORDS = 18;
const MIN_WORDS = 4;

/** Every word with when it is said, spread evenly over its line. */
function wordsOf(cues: Cue[]): { words: Word[]; end: number; gaps: Set<number> } {
  const words: Word[] = [];
  const gaps = new Set<number>(); // indexes of words after a pause
  let end = 0;
  cues.forEach((cue, index) => {
    const parts = cue.text.split(' ').filter(Boolean);
    const next = cues[index + 1]?.start_ms;
    const said = cue.end_ms ?? next ?? cue.start_ms + Math.max(MIN_LAST_MS, parts.length * MS_PER_WORD);
    const stop = Math.max(cue.start_ms + 1, next !== undefined ? Math.min(said, next) : said);
    if (index > 0 && cue.start_ms - end >= PAUSE_MS) gaps.add(words.length);
    const step = (stop - cue.start_ms) / parts.length;
    parts.forEach((text, i) => words.push({ text, at: Math.round(cue.start_ms + i * step) }));
    end = stop;
  });
  return { words, end, gaps };
}

const ENDS = /[.?!…]["'»”)]*$/;

/**
 * The cues as sentences: at `.?!` when the text has punctuation, otherwise at pauses; never longer
 * than ~10 s or 18 words. A sentence ends where the next one starts.
 */
export function toSentences(cues: Cue[]): Sentence[] {
  if (cues.length === 0) return [];
  const { words, end, gaps } = wordsOf(cues);
  const marks = words.filter((w) => ENDS.test(w.text)).length;
  const punctuated = marks > 0 && words.length / marks <= 30;
  const groups: Word[][] = [];
  let group: Word[] = [];
  words.forEach((word, index) => {
    const tooLong = group.length >= MAX_WORDS || (group.length > 0 && word.at - group[0].at >= MAX_MS);
    const pause = !punctuated && gaps.has(index) && group.length >= MIN_WORDS;
    if (group.length > 0 && (tooLong || pause)) {
      groups.push(group);
      group = [];
    }
    group.push(word);
    if (punctuated && ENDS.test(word.text)) {
      groups.push(group);
      group = [];
    }
  });
  if (group.length) groups.push(group);
  return groups.map((g, i) => ({
    start_ms: g[0].at,
    end_ms: i + 1 < groups.length ? groups[i + 1][0].at : end,
    text: g.map((w) => w.text).join(' '),
  }));
}

/** The first sentences up to about a minute: a first exercise's suggested part. */
export function suggestedRange(sentences: Sentence[], targetMs = 60_000): [number, number] {
  if (sentences.length === 0) return [0, 0];
  const from = sentences[0].start_ms;
  let last = 0;
  while (last + 1 < sentences.length && sentences[last + 1].end_ms - from <= targetMs) last += 1;
  return [0, last];
}

/** Two neighbouring sentences as one. */
export function mergeWithNext(sentences: Sentence[], index: number): Sentence[] {
  const next = sentences[index + 1];
  if (!next) return sentences;
  const merged = {
    start_ms: sentences[index].start_ms,
    end_ms: next.end_ms,
    text: `${sentences[index].text} ${next.text}`,
  };
  return [...sentences.slice(0, index), merged, ...sentences.slice(index + 2)];
}
