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
/** YouTube's automatic VTT gives each word its time: `Hello<00:00:09.120><c> everyone</c>`. */
const WORD_TIME = /<((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})>/;
/** «[Music]», «(applause)», «♪»: sounds, not words to say. */
const SOUND = /\[[^\]]*\]|\([^)]*\)|♪+/g;
/** A cue shown for a moment only to roll the previous line up: not new words. */
const ROLL_MS = 50;
/** How long a word with no end given is taken to last; a longer silence after it is a pause. */
const WORD_MS = 800;

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
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A line with each word's time: every word as its own cue, ending where the next begins. */
function timedWords(line: string, start: number, end: number): Cue[] {
  const pieces = line.split(WORD_TIME); // text, time, text, time, text …
  const words: { at: number; text: string }[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const at = i === 0 ? start : (timeOf(pieces[i - 1]) ?? start);
    for (const word of clean(pieces[i]).split(' ').filter(Boolean)) words.push({ at, text: word });
  }
  return words.map((word, i) => {
    const next = words[i + 1]?.at ?? end;
    return { start_ms: word.at, end_ms: Math.max(word.at + 1, Math.min(next, word.at + WORD_MS)), text: word.text };
  });
}

/**
 * Subtitle files: `start --> end` lines, each followed by its words. YouTube's automatic captions
 * roll: each cue repeats the line before it above the new one, with a 10 ms cue between that only
 * scrolls. Only the new words are kept, with their own times when the file gives them.
 */
function parseSubtitles(lines: string[]): Cue[] {
  const cues: Cue[] = [];
  let shown = new Set<string>(); // the lines of the cue before
  for (let i = 0; i < lines.length; i += 1) {
    const m = RANGE.exec(lines[i]);
    if (!m) continue;
    const start = timeOf(m[1]);
    const end = timeOf(m[2]);
    // The cue's lines run to the next time line: a rolling cue may hold a blank one (` `). An
    // .srt cue's number before that time line, after a blank, is not words.
    const block: string[] = [];
    for (i += 1; i < lines.length && !RANGE.exec(lines[i]); i += 1) block.push(lines[i]);
    i -= 1;
    const numbered = block.length >= 2 && /^\d+$/.test(block[block.length - 1].trim());
    if (numbered && block[block.length - 2].trim() === '') block.pop();
    if (start === null || end === null || end - start < ROLL_MS) continue;
    const timed = block.find((line) => WORD_TIME.test(line));
    const texts = block.map(clean).filter(Boolean);
    if (timed) {
      cues.push(...timedWords(timed, start, end));
    } else {
      const fresh = texts.filter((text) => !shown.has(text));
      if (fresh.length) cues.push({ start_ms: start, end_ms: end, text: fresh.join(' ') });
    }
    shown = new Set(block.map(clean).filter(Boolean));
  }
  return cues;
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
  end: number;
  /** Another speaker starts here (YouTube writes «>>»). */
  turn: boolean;
}

/** About how long a word takes to say, for the last line, whose end nobody wrote down. */
const MS_PER_WORD = 400;
const MIN_LAST_MS = 1500;
/** Without punctuation (automatic captions): a pause this long ends a sentence. */
const PAUSE_MS = 700;
/**
 * A whole sentence up to this is kept whole (learners: «cut mid-sentence» was the worst); a longer
 * one is cut where a speaker would breathe.
 */
const MAX_MS = 10_000;
const MAX_WORDS = 20;
/** Shorter than this («Yes.», «Hm.») is not worth a try alone: it joins a neighbour. */
const MIN_WORDS = 3;
const MIN_MS = 1_200;
/** Never a sentence this long, even with nowhere good to cut. */
const HARD_WORDS = 30;

/** Every word with when it is said: its own time when given, else spread evenly over its line. */
function wordsOf(cues: Cue[]): { words: Word[]; pauses: Set<number> } {
  const words: Word[] = [];
  const pauses = new Set<number>(); // indexes of words after a pause
  let end = 0;
  let turn = false;
  cues.forEach((cue, index) => {
    const parts = cue.text.split(' ').filter(Boolean);
    const next = cues[index + 1]?.start_ms;
    const said = cue.end_ms ?? next ?? cue.start_ms + Math.max(MIN_LAST_MS, parts.length * MS_PER_WORD);
    const stop = Math.max(cue.start_ms + 1, next !== undefined && next > cue.start_ms ? Math.min(said, next) : said);
    const step = (stop - cue.start_ms) / parts.length;
    parts.forEach((part, i) => {
      const at = Math.round(cue.start_ms + i * step);
      const speaker = /^(?:>>|»)/.test(part);
      const text = speaker ? part.replace(/^(?:>>|»)+/, '') : part;
      turn ||= speaker;
      if (!text) return;
      if (words.length > 0 && at - end >= PAUSE_MS) pauses.add(words.length);
      words.push({ text, at, end: Math.round(at + step), turn });
      turn = false;
      end = Math.round(at + step);
    });
  });
  return { words, pauses };
}

const ENDS = /[.?!…]["'»”)]*$/;
const SOFT = /[,;:—–]["'»”)]*$/;
/** A full stop that doesn't end a sentence: «Mr. English», «6 a.m. alarm». */
const ABBREVIATION = /^(?:mr|mrs|ms|dr|st|vs|etc|jr|sr|prof|mt|no|e\.g|i\.e|a\.m|p\.m|u\.s)\.$/i;
const ends = (word: string) => ENDS.test(word) && !ABBREVIATION.test(word);

/** Words a thought group starts with: a good place to cut before. */
const STARTERS = new Set(
  'and but so because when if which who that where while then or after before until although though since unless as'.split(
    ' ',
  ),
);
/** Words that lean on the next one: never cut after them. */
const LEANING = new Set(
  'a an the to of in on at for with from by my your our their his her its this these those is are was were be am i you we they he she it very not can will would could should do does did have has had and or but so than'.split(
    ' ',
  ),
);
const bare = (word: string) => word.toLowerCase().replace(/[^a-z']/g, '');

/** Before a sentence's first word, so it isn't clipped; after its last, its sound dies away. */
const LEAD_MS = 150;
const TAIL_MS = 300;
const GAP_MS = 50;

const lengthOf = (g: Word[]) => g[g.length - 1].end - g[0].at;
const fits = (g: Word[]) => g.length <= MAX_WORDS && lengthOf(g) <= MAX_MS;
const tooShort = (g: Word[]) => g.length < MIN_WORDS || lengthOf(g) < MIN_MS;

/**
 * A long sentence in two, where a speaker would breathe: after a comma, at a pause in the speech,
 * before «and / because / which…»; never after «the / to / my…» or inside «Mr. Smith». Near the
 * middle, each half a few words.
 */
function cut(group: Word[]): Word[][] {
  if (fits(group) || group.length < 2) return [group];
  const low = Math.min(MIN_WORDS, Math.floor(group.length / 2));
  let best = Math.floor(group.length / 2);
  let bestScore = -Infinity;
  for (let i = Math.max(1, low); i <= group.length - Math.max(1, low); i += 1) {
    const before = group[i - 1];
    const silence = Math.max(0, group[i].at - before.end);
    const score =
      (ends(before.text) ? 3 : SOFT.test(before.text) ? 2 : 0) +
      Math.min(silence / 300, 2) +
      (STARTERS.has(bare(group[i].text)) ? 1 : 0) -
      (LEANING.has(bare(before.text)) ? 2 : 0) -
      (ABBREVIATION.test(before.text) ? 5 : 0) -
      (2 * Math.abs(i - group.length / 2)) / group.length;
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return [...cut(group.slice(0, best)), ...cut(group.slice(best))];
}

/** Short sentences joined to a neighbour, the same speaker's first, never past a breath. */
function joinShort(groups: Word[][]): Word[][] {
  const out = [...groups];
  for (let i = 0; i < out.length; i += 1) {
    if (!tooShort(out[i])) continue;
    const next = out[i + 1];
    const previous = out[i - 1];
    const withNext = next && fits([...out[i], ...next]);
    const withPrevious = previous && fits([...previous, ...out[i]]);
    const sameNext = withNext && !next[0].turn;
    const samePrevious = withPrevious && !out[i][0].turn;
    // Across to the other speaker only a lone word («Yes.», «Hm.»): «I'm Emily.» stays hers.
    const lone = out[i].length === 1;
    if (sameNext || (withNext && lone && !samePrevious)) {
      out.splice(i, 2, [...out[i], ...next]);
      i -= 1; // the joined one may still be short
    } else if (samePrevious || (withPrevious && lone)) {
      out.splice(i - 1, 2, [...previous, ...out[i]]);
      i -= 2;
    }
  }
  return out;
}

/**
 * The cues as sentences to say after the video: they end at `.?!` (or, without punctuation, at a
 * pause) and where another speaker starts; one too long is cut where a speaker would breathe, one
 * too short («Yes.») joins a neighbour. A sentence starts a little before its first word and ends a
 * little after its last, never into the next.
 */
export function toSentences(cues: Cue[]): Sentence[] {
  const { words, pauses } = wordsOf(cues);
  if (words.length === 0) return [];
  const marks = words.filter((w) => ends(w.text)).length;
  const punctuated = marks > 0 && words.length / marks <= 30;
  const groups: Word[][] = [];
  let group: Word[] = [];
  words.forEach((word, index) => {
    const pause = !punctuated && pauses.has(index) && group.length >= MIN_WORDS;
    if (group.length > 0 && (word.turn || pause || group.length >= HARD_WORDS)) {
      groups.push(group);
      group = [];
    }
    group.push(word);
    if (punctuated && ends(word.text)) {
      groups.push(group);
      group = [];
    }
  });
  if (group.length) groups.push(group);
  const sentences = joinShort(groups.flatMap(cut));
  const out: Sentence[] = [];
  sentences.forEach((g, i) => {
    const first = g[0];
    const last = g[g.length - 1];
    const following = sentences[i + 1]?.[0];
    const start = Math.max(0, first.at - LEAD_MS, out[i - 1]?.end_ms ?? 0);
    const room = following ? following.at - GAP_MS : Infinity;
    const end = Math.max(start + 1, Math.min(last.end + TAIL_MS, Math.max(room, last.end)));
    out.push({ start_ms: Math.round(start), end_ms: Math.round(end), text: g.map((w) => w.text).join(' ') });
  });
  return out;
}

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The channel's own lines (or pasted text) on YouTube's recognised words: each of the text's words
 * takes the time its recognised twin is said, so a sentence starts and stops with its sound even
 * where a line has no word times. Words are matched in order, within their line's time (and a
 * little around it); a word left unmatched is placed between its matched neighbours. The text's
 * own spelling and punctuation are kept.
 */
export function alignWords(textCues: Cue[], recognised: Cue[]): Cue[] {
  if (recognised.length === 0) return textCues;
  // The text's words, each with the time of its line (where it may be said).
  const words: { text: string; key: string; from: number; to: number }[] = [];
  textCues.forEach((cue, index) => {
    const next = textCues[index + 1]?.start_ms;
    const to = cue.end_ms ?? next ?? cue.start_ms + 10_000;
    for (const text of cue.text.split(' ').filter(Boolean))
      words.push({ text, key: norm(text), from: cue.start_ms - 1_500, to: to + 1_500 });
  });
  const heard = recognised.map((cue) => ({
    key: norm(cue.text),
    at: cue.start_ms,
    end: cue.end_ms ?? cue.start_ms + 400,
  }));
  const times: ({ at: number; end: number } | null)[] = words.map(() => null);
  let j = 0;
  words.forEach((word, i) => {
    if (!word.key) return;
    for (let k = j; k < heard.length && heard[k].at <= word.to; k += 1) {
      if (heard[k].at < word.from) {
        j = k + 1;
        continue;
      }
      if (heard[k].key === word.key) {
        times[i] = { at: heard[k].at, end: heard[k].end };
        j = k + 1;
        break;
      }
      // Look a few words ahead only: the text may have a word the recognition missed.
      if (k - j > 6) break;
    }
  });
  // Unmatched words: spread between the matched ones around them (or their line's time).
  return words.map((word, i) => {
    const own = times[i];
    if (own) return { start_ms: own.at, end_ms: own.end, text: word.text };
    let before = i - 1;
    while (before >= 0 && !times[before]) before -= 1;
    let after = i + 1;
    while (after < words.length && !times[after]) after += 1;
    const from = before >= 0 ? times[before]!.end : Math.max(0, word.from + 1_500);
    const to = after < words.length ? times[after]!.at : Math.max(from + 400, word.to - 1_500);
    const share = (to - from) / (after - before);
    const at = Math.round(from + share * (i - before - 1));
    return { start_ms: at, end_ms: Math.round(at + Math.max(1, share)), text: word.text };
  });
}

/** Every sentence earlier (−) or later (+), for subtitles a little off from the sound. */
export function shiftTimes(sentences: Sentence[], ms: number): Sentence[] {
  return sentences.map((s) => ({
    ...s,
    start_ms: Math.max(0, s.start_ms + ms),
    end_ms: Math.max(1, s.end_ms + ms),
  }));
}

/** A sentence in two before its word `at` (1 … words − 1); the time is shared by the words. */
export function splitAt(sentences: Sentence[], index: number, at: number): Sentence[] {
  const sentence = sentences[index];
  const parts = sentence?.text.split(' ').filter(Boolean) ?? [];
  if (!sentence || at < 1 || at >= parts.length) return sentences;
  const cutMs = Math.round(sentence.start_ms + ((sentence.end_ms - sentence.start_ms) * at) / parts.length);
  return [
    ...sentences.slice(0, index),
    { start_ms: sentence.start_ms, end_ms: cutMs, text: parts.slice(0, at).join(' ') },
    { start_ms: cutMs, end_ms: sentence.end_ms, text: parts.slice(at).join(' ') },
    ...sentences.slice(index + 1),
  ];
}

/**
 * The sentences of a part: from the first one starting at `startMs` or later, as many as fit in
 * `lengthMs` (always at least one).
 */
export function rangeFrom(sentences: Sentence[], startMs: number, lengthMs: number): [number, number] {
  if (sentences.length === 0) return [0, 0];
  // A sentence starts a moment before its first word (LEAD_MS): one at «12:00» starts at 11:59.85.
  const found = sentences.findIndex((s) => s.start_ms >= startMs - LEAD_MS);
  const first = found < 0 ? sentences.length - 1 : found;
  const from = sentences[first].start_ms;
  let last = first;
  while (last + 1 < sentences.length && sentences[last + 1].end_ms - from <= lengthMs) last += 1;
  return [first, last];
}

/** The first sentences up to about a minute: a first exercise's suggested part. */
export function suggestedRange(sentences: Sentence[], targetMs = 60_000): [number, number] {
  return rangeFrom(sentences, 0, targetMs);
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
