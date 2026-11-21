import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mistake } from './api.ts';
import { collectFixes, collectIeltsFixes, segments } from './marks.ts';

const mistake = (original: string, corrected: string, type: Mistake['type'] = 'grammar'): Mistake => ({
  original,
  corrected,
  explanation: 'why',
  type,
});

const ANSWER = 'I no have car. I go to univercity by bus every day.\nAfter that I watch good films.';

test('fixes are numbered in reading order, whatever order the model gave them in', () => {
  const fixes = collectFixes(ANSWER, {
    corrections: [mistake('univercity', 'university', 'spelling'), mistake('I no have car', "I don't have a car")],
    vocabulary: [{ original: 'good films', suggestion: 'interesting films', note: 'More precise.' }],
  });
  assert.deepEqual(
    fixes.map((f) => [f.n, f.original, f.home, f.kind]),
    [
      [1, 'I no have car', 'grammar', 'mistake'],
      [2, 'univercity', 'mechanics', 'mistake'],
      [3, 'good films', 'vocabulary', 'tip'],
    ],
  );
});

test('each fix carries the rest of its own sentence, and no more', () => {
  const [, spelling, tip] = collectFixes(ANSWER, {
    corrections: [mistake('I no have car', 'x'), mistake('univercity', 'university', 'spelling')],
    vocabulary: [{ original: 'good films', suggestion: 'interesting films', note: '' }],
  });
  assert.equal(spelling.before, 'I go to ');
  assert.equal(spelling.after, ' by bus every day.');
  // A new line ends a sentence too.
  assert.equal(tip.before, 'After that I watch ');
  assert.equal(tip.after, '.');
});

test('a quote not in the answer is still listed, last, with no place and no context', () => {
  const fixes = collectFixes(ANSWER, {
    corrections: [mistake('I has a car', 'I have a car'), mistake('univercity', 'university', 'spelling')],
    vocabulary: [],
  });
  assert.deepEqual(
    fixes.map((f) => [f.n, f.original, f.start]),
    [
      [1, 'univercity', ANSWER.indexOf('univercity')],
      [2, 'I has a car', null],
    ],
  );
  assert.equal(fixes[1].before + fixes[1].after, '');
});

test('a different letter case still finds the place', () => {
  const [fix] = collectFixes(ANSWER, { corrections: [mistake('i NO have', 'x')], vocabulary: [] });
  assert.equal(fix.start, 0);
});

test('the same words quoted twice mark two places, never one place twice', () => {
  const text = 'He go home. She go home.';
  const fixes = collectFixes(text, { corrections: [mistake('go', 'goes'), mistake('go', 'goes')], vocabulary: [] });
  assert.deepEqual(
    fixes.map((f) => f.start),
    [3, 16],
  );
});

test('overlapping quotes: the second is listed but not highlighted over the first', () => {
  const fixes = collectFixes(ANSWER, {
    corrections: [mistake('I no have car', 'x'), mistake('have car', 'have a car')],
    vocabulary: [],
  });
  assert.equal(fixes[1].start, null);
});

test('the segments put the whole answer back together, with the fixes marked', () => {
  const fixes = collectFixes(ANSWER, {
    corrections: [mistake('I no have car', 'x'), mistake('univercity', 'university', 'spelling')],
    vocabulary: [],
  });
  const parts = segments(ANSWER, fixes);
  assert.equal(parts.map((p) => p.text).join(''), ANSWER);
  assert.deepEqual(
    parts.filter((p) => p.fix).map((p) => [p.text, p.fix!.n]),
    [
      ['I no have car', 1],
      ['univercity', 2],
    ],
  );
});

test('a very long sentence is cut to a readable piece around the fix', () => {
  const long = `${'word '.repeat(60)}mistake ${'word '.repeat(60)}end.`;
  const [fix] = collectFixes(long, { corrections: [mistake('mistake', 'fix')], vocabulary: [] });
  assert.ok(fix.before.startsWith('…') && fix.before.length <= 92);
  assert.ok(fix.after.endsWith('…') && fix.after.length <= 92);
});

test('IELTS fixes: grammar and punctuation under GRA, spelling, word choice and upgrades under LR', () => {
  const fixes = collectIeltsFixes(ANSWER, {
    corrections: [
      { original: 'I no have', corrected: "I don't have", explanation: 'neg', type: 'grammar' },
      { original: 'univercity', corrected: 'university', explanation: 'sp', type: 'spelling' },
    ],
    upgrades: [{ original: 'good', suggestion: 'excellent', note: 'stronger' }],
  });
  const homes = Object.fromEntries(fixes.map((f) => [f.original, f.home]));
  assert.equal(homes['I no have'], 'grammatical_range_accuracy');
  assert.equal(homes['univercity'], 'lexical_resource');
  assert.equal(homes['good'], 'lexical_resource');
});
