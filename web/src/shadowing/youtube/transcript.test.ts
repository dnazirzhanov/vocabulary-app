import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeWithNext, parseTranscript, suggestedRange, toSentences } from './transcript.ts';

// As YouTube's «Show transcript» panel copies: a time line, then the words; a chapter's name between.
const PANEL = `Daily English
0:00
Good morning, everyone.
0:03
Today we talk about food. What do you
0:08
like to eat? I like apples.
Breakfast
0:14
[Music]
0:16
Let's start.`;

test('the panel: times and words; the title, chapters and sounds are left out', () => {
  assert.deepEqual(parseTranscript(PANEL), [
    { start_ms: 0, end_ms: null, text: 'Good morning, everyone.' },
    { start_ms: 3000, end_ms: null, text: 'Today we talk about food. What do you' },
    { start_ms: 8000, end_ms: null, text: 'like to eat? I like apples.' },
    { start_ms: 16000, end_ms: null, text: "Let's start." },
  ]);
});

test('the panel with the time and words on one line, and hours', () => {
  const cues = parseTranscript('0:05 hello there\n1:02:03 the end\n');
  assert.deepEqual(
    cues.map((c) => [c.start_ms, c.text]),
    [
      [5000, 'hello there'],
      [3723000, 'the end'],
    ],
  );
});

test('text without any times gives nothing (the learner is asked for the times)', () => {
  assert.deepEqual(parseTranscript('Good morning, everyone.\nToday we talk about food.'), []);
  // A number in the words is not a time.
  assert.deepEqual(parseTranscript('I have 10 apples\nand 3:75 is no time'), []);
});

test('an .srt file', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,500
Hello, <i>everyone</i>.

2
00:00:03,500 --> 00:00:06,000
Nice to meet you &amp; welcome!
`;
  assert.deepEqual(parseTranscript(srt), [
    { start_ms: 1000, end_ms: 3500, text: 'Hello, everyone.' },
    { start_ms: 3500, end_ms: 6000, text: 'Nice to meet you & welcome!' },
  ]);
});

test('a .vtt file, its rolling repeats kept once', () => {
  const vtt = `WEBVTT
Kind: captions

00:00.000 --> 00:02.000 align:start
so today

00:02.000 --> 00:02.010
so today

00:02.010 --> 00:04.000
we cook pasta
`;
  assert.deepEqual(
    parseTranscript(vtt).map((c) => c.text),
    ['so today', 'we cook pasta'],
  );
});

test('punctuated text becomes sentences, each ending where the next starts', () => {
  const sentences = toSentences(parseTranscript(PANEL));
  assert.deepEqual(
    sentences.map((s) => s.text),
    [
      'Good morning, everyone.',
      'Today we talk about food.',
      'What do you like to eat?',
      'I like apples.',
      "Let's start.",
    ],
  );
  // «Today we talk about food.» is the first 5 of 8 words in the line from 3 s to 8 s.
  assert.equal(sentences[1].start_ms, 3000);
  assert.equal(sentences[2].start_ms, 3000 + Math.round((5 * 5000) / 8));
  for (let i = 0; i + 1 < sentences.length; i += 1) assert.equal(sentences[i].end_ms, sentences[i + 1].start_ms);
  // The last line's end isn't written anywhere: about how long its words take, at least 1.5 s.
  assert.equal(sentences.at(-1)!.end_ms, 16000 + 1500);
});

test('automatic captions (no punctuation) split at pauses and never run long', () => {
  const auto = parseTranscript(
    [
      '0:00',
      'so today we are going to',
      '0:02',
      'cook some pasta together',
      '0:05',
      'first you need water',
      // A pause: the line before ends at 0:07, this one starts at 0:09.
      '0:09',
      'and then some salt and',
      '0:11',
      'a big pot',
    ].join('\n'),
  ).map((c, i, all) => ({ ...c, end_ms: i === 2 ? 7000 : (all[i + 1]?.start_ms ?? c.start_ms + 2000) }));
  const sentences = toSentences(auto);
  assert.deepEqual(
    sentences.map((s) => s.text),
    ['so today we are going to cook some pasta together first you need water', 'and then some salt and a big pot'],
  );
  assert.equal(sentences[1].start_ms, 9000);

  const endless = parseTranscript(
    Array.from({ length: 12 }, (_, i) => `0:${String(i * 2).padStart(2, '0')}\nwe keep on talking here`).join('\n'),
  );
  for (const s of toSentences(endless)) {
    assert.ok(s.text.split(' ').length <= 18, s.text);
    assert.ok(s.end_ms - s.start_ms <= 10_000 + 2_000, `${s.start_ms}–${s.end_ms}`);
  }
});

test('the suggested part: the first minute or so', () => {
  const sentences = Array.from({ length: 30 }, (_, i) => ({
    start_ms: 5000 + i * 7000,
    end_ms: 12000 + i * 7000,
    text: `s${i}`,
  }));
  const [first, last] = suggestedRange(sentences);
  assert.equal(first, 0);
  assert.equal(sentences[last].end_ms - sentences[0].start_ms <= 60_000, true);
  assert.equal(sentences[last + 1].end_ms - sentences[0].start_ms > 60_000, true);
  assert.deepEqual(suggestedRange([]), [0, 0]);
});

test('merging two sentences keeps their times', () => {
  const sentences = [
    { start_ms: 0, end_ms: 4000, text: 'one two three four' },
    { start_ms: 4000, end_ms: 6000, text: 'five six' },
  ];
  assert.deepEqual(mergeWithNext(sentences, 0), [{ start_ms: 0, end_ms: 6000, text: 'one two three four five six' }]);
  assert.equal(mergeWithNext(sentences, 1), sentences);
});
