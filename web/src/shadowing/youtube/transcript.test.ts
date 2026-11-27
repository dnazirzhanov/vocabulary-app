import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignWords,
  mergeWithNext,
  parseTranscript,
  rangeFrom,
  shiftTimes,
  splitAt,
  suggestedRange,
  toSentences,
  type Sentence,
} from './transcript.ts';

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
      // «Let's start.» alone is too short to be worth a try: it joins the sentence before.
      "I like apples. Let's start.",
    ],
  );
  // «Today we talk about food.» is the first 5 of 8 words in the line from 3 s to 8 s.
  assert.equal(sentences[1].start_ms, 3000);
  assert.equal(sentences[2].start_ms, 3000 + Math.round((5 * 5000) / 8));
  for (let i = 0; i + 1 < sentences.length; i += 1) assert.equal(sentences[i].end_ms, sentences[i + 1].start_ms);
  // The last line's end isn't written anywhere: about how long its words take, at least 1.5 s.
  // …and the last sentence ends a little after it (0.3 s), as its sound dies away.
  assert.equal(sentences.at(-1)!.end_ms, 16000 + 1500 + 300);
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
  // A little before its first word (0.15 s), so it isn't clipped.
  assert.equal(sentences[1].start_ms, 9000 - 150);

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

test('a part chosen by its start and length: from that minute, as much as fits', () => {
  // A sentence every 5 s for 30 minutes.
  const sentences = Array.from({ length: 360 }, (_, i) => ({
    start_ms: i * 5000,
    end_ms: i * 5000 + 5000,
    text: `s${i}`,
  }));
  // From 12:00, ten minutes: sentences 144 (12:00) to 263 (ends at 22:00).
  assert.deepEqual(rangeFrom(sentences, 12 * 60_000, 10 * 60_000), [144, 263]);
  // Near the end there is less left than asked for.
  assert.deepEqual(rangeFrom(sentences, 29 * 60_000, 10 * 60_000), [348, 359]);
  // Past the last sentence: the last one.
  assert.deepEqual(rangeFrom(sentences, 99 * 60_000, 60_000), [359, 359]);
  // A sentence longer than the part still makes a part of one.
  assert.deepEqual(rangeFrom([{ start_ms: 0, end_ms: 90_000, text: 'long' }], 0, 60_000), [0, 0]);
  assert.deepEqual(rangeFrom([], 0, 60_000), [0, 0]);
});

test('merging two sentences keeps their times', () => {
  const sentences = [
    { start_ms: 0, end_ms: 4000, text: 'one two three four' },
    { start_ms: 4000, end_ms: 6000, text: 'five six' },
  ];
  assert.deepEqual(mergeWithNext(sentences, 0), [{ start_ms: 0, end_ms: 6000, text: 'one two three four five six' }]);
  assert.equal(mergeWithNext(sentences, 1), sentences);
});

// As YouTube's automatic captions come as .vtt: each cue repeats the line before it above the new
// words (which carry their own times), a 10 ms cue between only scrolls, «>>» marks another
// speaker, and «>» is written «&gt;».
const ROLLING = `WEBVTT
Kind: captions
Language: en

00:00:00.300 --> 00:00:04.000 align:start position:0%
 
[Music]

00:00:04.000 --> 00:00:04.010 align:start position:0%
[Music]
 

00:00:04.010 --> 00:00:07.000 align:start position:0%
[Music]
Good<00:00:04.500><c> evening</c><00:00:05.000><c> and</c><00:00:05.400><c> welcome</c><00:00:06.000><c> to</c><00:00:06.400><c> our</c>

00:00:07.000 --> 00:00:07.010 align:start position:0%
Good evening and welcome to our
 

00:00:07.010 --> 00:00:10.000 align:start position:0%
Good evening and welcome to our
little<00:00:07.400><c> show.</c><00:00:08.200><c> I'm</c><00:00:08.600><c> Kate.</c>

00:00:10.000 --> 00:00:10.010 align:start position:0%
little show. I'm Kate.
 

00:00:10.010 --> 00:00:13.000 align:start position:0%
little show. I'm Kate.
&gt;&gt; Hi<00:00:10.400><c> Kate.</c><00:00:11.000><c> How</c><00:00:11.300><c> are</c><00:00:11.500><c> you</c><00:00:11.800><c> today?</c>

00:00:13.000 --> 00:00:13.010 align:start position:0%
&gt;&gt; Hi Kate. How are you today?
 

00:00:13.010 --> 00:00:15.000 align:start position:0%
&gt;&gt; Hi Kate. How are you today?
&gt;&gt; Yes.<00:00:13.600><c> Very</c><00:00:14.000><c> well,</c><00:00:14.300><c> thanks.</c>
`;

const texts = (sentences: Sentence[]) => sentences.map((s) => s.text);

test('rolling automatic captions: each word once, at its own time, no «&gt;&gt;»', () => {
  const sentences = toSentences(parseTranscript(ROLLING));
  assert.deepEqual(texts(sentences), [
    // «I'm Kate.» alone is two words: it stays with the sentence before.
    "Good evening and welcome to our little show. I'm Kate.",
    'Hi Kate. How are you today?',
    'Yes. Very well, thanks.',
  ]);
  // Each starts with its first word: «Good» when its line starts, then each speaker's line.
  assert.deepEqual(
    sentences.map((s) => s.start_ms),
    // 0.15 s before each first word, never into the sentence before.
    [3860, 9860, 12900],
  );
  // «Good» is said at 4.01 s, «evening» at 4.5 s: words have their own times, not spread evenly.
  assert.equal(parseTranscript(ROLLING)[1].start_ms, 4500);
});

test('a sentence of a word or two joins its neighbour; a long one is cut at a comma', () => {
  const words = (text: string, from: number, step = 400) =>
    text.split(' ').map((w, i) => ({ start_ms: from + i * step, end_ms: from + (i + 1) * step, text: w }));
  const cues = [
    ...words('Exactly.', 0),
    ...words(
      'We often just say I am good or I am okay, but there are so many more ways to say how we feel.',
      1000,
      300,
    ),
    ...words('>> Hm.', 10_000),
    ...words('>> A simple thing is a nice message from a friend.', 12_000),
  ];
  const result = texts(toSentences(cues));
  assert.deepEqual(result, [
    'Exactly. We often just say I am good or I am okay,',
    'but there are so many more ways to say how we feel.',
    'Hm. A simple thing is a nice message from a friend.',
  ]);
  for (const text of result) assert.ok(text.split(' ').length <= 15, text);
  // «Mr.» and «a.m.» don't end a sentence.
  assert.deepEqual(texts(toSentences(words('Welcome back to Mr. English channel. The 6 a.m. alarm is loud.', 0))), [
    'Welcome back to Mr. English channel.',
    'The 6 a.m. alarm is loud.',
  ]);
});

test('a whole sentence up to 20 words is kept; a longer one is cut where a speaker breathes', () => {
  const words = (text: string, from: number, step = 350) =>
    text.split(' ').map((w, i) => ({ start_ms: from + i * step, end_ms: from + i * step + step, text: w }));
  // 18 words, 6.3 s: once cut at its comma («And before we get into our topic, | let's…»), now whole.
  const whole = 'And before we get into our topic, let us quickly remind our friends how they can support the channel.';
  assert.deepEqual(texts(toSentences(words(whole, 0))), [whole]);
  // 28 words: cut once, after the comma, not after «the» or «to».
  const long =
    'When I was a child I wanted to become a doctor like my mother, because she helped so many people in our small town every day.';
  const parts = texts(toSentences(words(long, 0, 300)));
  assert.deepEqual(parts, [
    'When I was a child I wanted to become a doctor like my mother,',
    'because she helped so many people in our small town every day.',
  ]);
});

test('a short turn joins the same speaker, not the other one', () => {
  const words = (text: string, from: number) =>
    text.split(' ').map((w, i) => ({ start_ms: from + i * 400, end_ms: from + i * 400 + 400, text: w }));
  const cues = [
    ...words('It helps us so much.', 0),
    ...words('>> It does. And sharing with your friends is the best way to help our community grow.', 3000),
  ];
  assert.deepEqual(texts(toSentences(cues)), [
    'It helps us so much.',
    'It does. And sharing with your friends is the best way to help our community grow.',
  ]);
});

test('the channel’s own lines take the recognised words’ times', () => {
  // A line of 9 words from 0 to 9 s, but the words are said early: 0.5 s apart from 1 s.
  const line = [{ start_ms: 0, end_ms: 9000, text: "Hello, everyone. It's six a.m. here, Paul." }];
  const heard = 'hello everyone its 6 am here paul'
    .split(' ')
    .map((w, i) => ({ start_ms: 1000 + i * 500, end_ms: 1400 + i * 500, text: w }));
  const aligned = alignWords(line, heard);
  assert.deepEqual(
    aligned.map((c) => c.text),
    ['Hello,', 'everyone.', "It's", 'six', 'a.m.', 'here,', 'Paul.'],
  );
  // Matched words take their twin's time; «six» and «a.m.» (heard «6», «am») sit between.
  assert.equal(aligned[0].start_ms, 1000);
  assert.equal(aligned[2].start_ms, 2000);
  assert.ok(aligned[3].start_ms > aligned[2].start_ms && aligned[4].start_ms < aligned[5].start_ms);
  assert.equal(aligned[6].start_ms, 4000);
  // So the sentence starts and stops with the sound (1 s – 4.4 s), not with the line (0 – 9 s).
  const [only] = toSentences(aligned);
  assert.equal(only.start_ms, 1000 - 150);
  assert.equal(only.end_ms, 4400 + 300);
  // Nothing heard: the text as it was.
  assert.deepEqual(alignWords(line, []), line);
});

test('shifting and splitting', () => {
  const two = [
    { start_ms: 1000, end_ms: 3000, text: 'one two three four' },
    { start_ms: 3000, end_ms: 4000, text: 'five six' },
  ];
  assert.deepEqual(
    shiftTimes(two, -300).map((s) => [s.start_ms, s.end_ms]),
    [
      [700, 2700],
      [2700, 3700],
    ],
  );
  assert.equal(shiftTimes(two, -5000)[0].start_ms, 0);
  assert.deepEqual(splitAt(two, 0, 1), [
    { start_ms: 1000, end_ms: 1500, text: 'one' },
    { start_ms: 1500, end_ms: 3000, text: 'two three four' },
    two[1],
  ]);
  assert.equal(splitAt(two, 0, 0), two);
  assert.equal(splitAt(two, 1, 2), two);
});
