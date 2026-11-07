import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { en } from './en.ts';
import { kk } from './kk.ts';
import { ky } from './ky.ts';
import { ru, type Messages } from './ru.ts';
import { tg } from './tg.ts';
import { uz } from './uz.ts';

// The compiler already refuses a missing or extra line; these catch what it can't see.
const LANGUAGES: Record<string, Messages> = { en, uz, kk, ky, tg };
const LATIN = new Set(['en', 'uz']);
const KEYS = Object.keys(ru) as (keyof Messages)[];
/** Lines that really are the same as in Russian: loanwords and the app's name. Add sparingly. */
const SAME_AS_RUSSIAN: Record<string, Set<string>> = {
  kk: new Set(['slovar', 'n1Min', 'account', 'test', 'code']),
  ky: new Set(['slovar', 'account', 'test', 'topic', 'text']),
  tg: new Set(['slovar']),
};

/** Arguments that aren't plain text, by the message's signature. */
const ARGUMENTS: Partial<Record<keyof Messages, unknown[]>> = {
  dayMonth: [13, 10],
  inDays: [7],
  wordsCount: [7],
  newWordsCount: [7],
  membersCount: [7],
  photosCount: [7],
  weeksInARow: [7],
  deleteAccountWarning: [true],
  deckWordsWillBeDeleted: [7],
  deckIsGivenWarning: [7, 'NAMES'],
  textFromPhotos: [7],
  readingAndMakingCards: [true],
  letterRemove: [3, 'q', true],
  deadlineInDays: [7, 'REST'],
  weekSummary: [['DAYS']],
  dayCards: ['DATE', 7, true],
  weekDaysDone: [7],
  daysLeftToGoal: [7],
  yearCounted: ['YEAR', 6, 'COUNTED'],
  yearCards: ['YEAR', 6, 7],
  pausedProgress: [41, 42, 43, 44, 45],
  spellingLead: [41, 42, 43],
  lessonLead: [['PARTS'], 'NEXT'],
};
/** What must show in each message: its plain arguments, except those a word stands for. */
const shown = (key: keyof Messages, args: unknown[]): string[] => {
  if (key === 'dayMonth') return ['13'];
  if (key === 'deleteAccountWarning' || key === 'readingAndMakingCards' || key === 'textFromPhotos') return [];
  if (key === 'deckIsGivenWarning') return ['NAMES'];
  if (key === 'deckWordsWillBeDeleted') return ['7'];
  return args
    .flat()
    .filter((arg) => typeof arg !== 'boolean')
    .map(String);
};

const call = (message: unknown, key: keyof Messages) => {
  const fn = message as (...args: unknown[]) => string;
  const args = ARGUMENTS[key] ?? Array.from({ length: fn.length }, (_, index) => `ARG${index}`);
  return { text: fn(...args), args };
};

const texts = (messages: Messages): [keyof Messages, string][] =>
  KEYS.flatMap((key) => {
    const message = messages[key];
    if (typeof message === 'function') return [[key, call(message, key).text]] as [keyof Messages, string][];
    if (Array.isArray(message)) return message.map((item) => [key, item] as [keyof Messages, string]);
    return [[key, message as string]] as [keyof Messages, string][];
  });

for (const [name, messages] of Object.entries({ ru, ...LANGUAGES })) {
  test(`${name}: every sentence keeps everything put into it`, () => {
    for (const key of KEYS) {
      const message = messages[key];
      assert.equal(typeof message, typeof ru[key], key);
      if (typeof message !== 'function') continue;
      assert.equal(message.length, (ru[key] as () => string).length, `${key}: another number of arguments`);
      const { text, args } = call(message, key);
      for (const arg of shown(key, args)) assert.ok(text.includes(arg), `${key} lost ${arg}: ${text}`);
    }
  });

  test(`${name}: markup and fixed lists stay in shape`, () => {
    assert.ok(messages.startedOfWords('x').includes('{0}'));
    assert.ok(messages.weekDaysDone(5).includes('{0}'));
    assert.equal(messages.weekdays.length, 7);
    assert.equal(messages.monthNames.length, 12);
    for (let month = 0; month < 12; month += 1) assert.ok(!messages.dayMonth(1, month).includes('undefined'));
  });
}

for (const [name, messages] of Object.entries(LANGUAGES)) {
  test(`${name}: no Russian left behind`, () => {
    const same = SAME_AS_RUSSIAN[name] ?? new Set<string>();
    for (const key of KEYS) {
      const message = messages[key];
      if (typeof message !== 'string' || same.has(key)) continue;
      if (/\p{L}/u.test(message)) assert.notEqual(message, ru[key], `${key} is still Russian`);
    }
    if (LATIN.has(name)) {
      for (const [key, text] of texts(messages)) assert.ok(!/[Ѐ-ӿ]/.test(text), `${key}: ${text}`);
    }
  });
}

test('every letter belongs to the language', () => {
  // Letters beyond Russian's: a stray one from another alphabet slips past the eye, not past this.
  const OWN: Record<string, RegExp> = {
    ru: /[\p{Script=Cyrillic}A-Za-z]/u,
    en: /[A-Za-z]/u,
    uz: /[A-Za-z]/u,
    kk: /[\p{Script=Cyrillic}A-Za-z]/u,
    ky: /[\p{Script=Cyrillic}A-Za-z]/u,
    tg: /[\p{Script=Cyrillic}A-Za-z]/u,
  };
  for (const [name, messages] of Object.entries({ ru, ...LANGUAGES })) {
    for (const [key, text] of texts(messages)) {
      for (const letter of text.match(/\p{L}/gu) ?? []) {
        assert.ok(OWN[name].test(letter), `${name}.${key}: «${letter}» in ${text}`);
      }
    }
  }
  // Letters that only these alphabets have, so a translation that fell back to Russian shows.
  assert.match(
    texts(kk)
      .map(([, text]) => text)
      .join(''),
    /[әғқңөұүһі]/,
  );
  assert.match(
    texts(ky)
      .map(([, text]) => text)
      .join(''),
    /[ңөү]/,
  );
  assert.match(
    texts(tg)
      .map(([, text]) => text)
      .join(''),
    /[ғӣқӯҳҷ]/,
  );
  assert.ok(
    !/[ғӣқӯҳҷәұһі]/.test(
      texts(ky)
        .map(([, text]) => text)
        .join(''),
    ),
    'Kazakh or Tajik letters in Kyrgyz',
  );
  assert.ok(
    !/[әұһіңөү]/.test(
      texts(tg)
        .map(([, text]) => text)
        .join(''),
    ),
    'Kazakh or Kyrgyz letters in Tajik',
  );
});

test('no line of text sits unused', () => {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk(new URL('..', import.meta.url).pathname);
  const all = sources.join('\n');
  for (const key of KEYS) assert.ok(all.includes(`t.${key}`), `unused: ${key}`);
});
