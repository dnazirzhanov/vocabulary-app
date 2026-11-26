/* eslint-disable no-restricted-syntax -- the words a learner types («завтра», «каждый день») are
   what is recognised here, not text shown to anyone: they belong with the patterns. */
/**
 * Quick add's understanding of a typed line (ADR 0084), like TickTick's smart recognition:
 * «Английский каждый день в 21:00» → title «Английский», repeats daily, at 21:00. Russian and
 * English. Each part found is returned with where it was, so the line can show it highlighted and
 * the learner can tap it to keep it as plain text (`ignore`).
 */
import { addDays, weekday } from './dates.ts';

export interface Found {
  /** The words as typed, to show highlighted and to ignore. */
  text: string;
  kind: 'date' | 'time' | 'repeat';
}

export interface Parsed {
  title: string;
  dueOn: string | null;
  startMinute: number | null;
  /** «с 19:00 до 20:00»: until when, if said. */
  endMinute: number | null;
  repeatMask: number;
  found: Found[];
}

const DAILY = 127;
const WEEKDAYS = 31;
const WEEKENDS = 96;

// Weekday stems: Monday first, as the masks.
const RU_DAYS = ['понедельник', 'вторник', 'сред', 'четверг', 'пятниц', 'суббот', 'воскресень'];
const EN_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const RU_DAY = `(${RU_DAYS.join('|')})[а-я]*`;
const EN_DAY = `(${EN_DAYS.join('|')})s?`;

function dayIndex(word: string): number {
  const w = word.toLowerCase();
  const ru = RU_DAYS.findIndex((stem) => w.startsWith(stem));
  return ru >= 0 ? ru : EN_DAYS.findIndex((name) => w.startsWith(name));
}

/** The next date that is that weekday: today if it is. */
function nextDay(today: string, index: number): string {
  return addDays(today, (index - weekday(today) + 7) % 7);
}

interface Rule {
  kind: Found['kind'];
  pattern: RegExp;
  apply: (m: RegExpExecArray, today: string, into: Parsed) => void;
}

const hour12 = (h: number, part: string) => {
  const p = part.toLowerCase();
  if (/^(pm|вечера|дня)$/.test(p)) return h < 12 ? h + 12 : h;
  if (/^(am|утра|ночи)$/.test(p)) return h === 12 ? 0 : h;
  return h;
};

function range(m: RegExpExecArray, p: Parsed): void {
  // A part of the day said once covers both ends: «с 7 до 8 вечера».
  const part = m[6] ?? m[3] ?? '';
  const start = hour12(Number(m[1]), m[3] ?? part) * 60 + Number(m[2] ?? 0);
  const end = hour12(Number(m[4]), m[6] ?? part) * 60 + Number(m[5] ?? 0);
  p.startMinute = start;
  if (end > start) p.endMinute = end;
}

// Order matters: repeats before plain weekdays, ranges before single times.
const RULES: Rule[] = [
  {
    kind: 'repeat',
    pattern: /(каждый день|ежедневно|every ?day|daily)/i,
    apply: (_, __, p) => void (p.repeatMask = DAILY),
  },
  {
    kind: 'repeat',
    pattern: /(по будням|в будни|каждый будний день|on weekdays|every weekday|weekdays)/i,
    apply: (_, __, p) => void (p.repeatMask = WEEKDAYS),
  },
  {
    kind: 'repeat',
    pattern: /(по выходным|в выходные|on weekends|every weekend|weekends)/i,
    apply: (_, __, p) => void (p.repeatMask = WEEKENDS),
  },
  {
    // One day or several: «по средам и субботам», «каждый понедельник, среду и пятницу»,
    // «every wednesday and saturday».
    kind: 'repeat',
    pattern: new RegExp(
      `(?:кажд[а-я]+ |по )${RU_DAY}(?:(?:, ?| и )(?:в |во )?${RU_DAY})*|(?:every|on) ${EN_DAY}(?:(?:, ?| and )${EN_DAY})*`,
      'i',
    ),
    apply: (m, __, p) => {
      for (const word of m[0].toLowerCase().match(new RegExp(`${RU_DAY}|${EN_DAY}`, 'gi')) ?? []) {
        p.repeatMask |= 1 << dayIndex(word);
      }
    },
  },
  { kind: 'date', pattern: /(послезавтра|day after tomorrow)/i, apply: (_, t, p) => void (p.dueOn = addDays(t, 2)) },
  { kind: 'date', pattern: /(завтра|tomorrow)/i, apply: (_, t, p) => void (p.dueOn = addDays(t, 1)) },
  { kind: 'date', pattern: /(сегодня|today)/i, apply: (_, t, p) => void (p.dueOn = t) },
  {
    kind: 'date',
    pattern: new RegExp(`(?:во? ${RU_DAY}|(?:on )?${EN_DAY})`, 'i'),
    apply: (m, t, p) => void (p.dueOn = nextDay(t, dayIndex(m[1] ?? m[2]))),
  },
  {
    // «с 19:00 до 20:00», «с 7 до 8 вечера», «from 7pm to 8pm».
    kind: 'time',
    pattern:
      /(?:с|from) ([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s?(am|pm|утра|вечера|дня|ночи)? (?:до|to) ([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s?(am|pm|утра|вечера|дня|ночи)?/i,
    apply: (m, _, p) => range(m, p),
  },
  {
    // «19:00–20:00»: both with minutes, so «2-3 слова» stays a title.
    kind: 'time',
    pattern: /([01]?\d|2[0-3])[:.]([0-5]\d)\s?[-–—]\s?([01]?\d|2[0-3])[:.]([0-5]\d)/i,
    apply: (m, _, p) => {
      p.startMinute = Number(m[1]) * 60 + Number(m[2]);
      const end = Number(m[3]) * 60 + Number(m[4]);
      if (end > p.startMinute) p.endMinute = end;
    },
  },
  {
    kind: 'time',
    pattern: /(?:в |at )?([01]?\d|2[0-3])[:.]([0-5]\d)/i,
    apply: (m, _, p) => void (p.startMinute = Number(m[1]) * 60 + Number(m[2])),
  },
  {
    kind: 'time',
    pattern: /(?:в |at )?(1[0-2]|0?[1-9])\s?(am|pm|утра|вечера|дня|ночи)/i,
    apply: (m, _, p) => void (p.startMinute = hour12(Number(m[1]), m[2]) * 60),
  },
];

export function parseQuick(line: string, today: string, ignore: readonly string[] = []): Parsed {
  const parsed: Parsed = { title: '', dueOn: null, startMinute: null, endMinute: null, repeatMask: 0, found: [] };
  let rest = ` ${line} `;
  for (const rule of RULES) {
    // Words around a match must be whole: «завтрак» is no «завтра».
    const whole = new RegExp(`(?<=[\\s,.;])${rule.pattern.source}(?=[\\s,.;!?])`, rule.pattern.flags);
    const m = whole.exec(rest);
    if (!m) continue;
    const text = m[0].trim();
    if (ignore.some((kept) => kept.toLowerCase() === text.toLowerCase())) continue;
    if (rule.kind === 'time' && parsed.startMinute !== null) continue;
    if (rule.kind === 'date' && (parsed.dueOn !== null || parsed.repeatMask)) continue;
    rule.apply(m, today, parsed);
    parsed.found.push({ text, kind: rule.kind });
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
  }
  // A repeat starts on its first day from today.
  if (parsed.repeatMask && parsed.dueOn === null) {
    let day = today;
    while (!(parsed.repeatMask & (1 << weekday(day)))) day = addDays(day, 1);
    parsed.dueOn = day;
  }
  parsed.title = rest.replace(/\s+/g, ' ').trim();
  return parsed;
}
