import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pieces, quoteOf, runs, sentenceAt, snap, type Highlight } from './text.ts';

const body = [
  "The Wright brothers' plane didn't fly far. It flew 36 meters!",
  'Few newspapers, however, noted the event.',
];

test('a paragraph is words and the text between them, nothing lost or added', () => {
  const parts = pieces(body[0]);
  assert.equal(parts.map((part) => part.text).join(''), body[0]);
  assert.deepEqual(
    parts.filter((part) => part.key).map((part) => part.key),
    ['the', 'wright', 'brothers', 'plane', "didn't", 'fly', 'far', 'it', 'flew', 'meters'],
  );
  // Offsets point at the word in the text.
  const plane = parts.find((part) => part.key === 'plane')!;
  assert.equal(body[0].slice(plane.start, plane.end), 'plane');
});

test('a selection snaps to whole words, across paragraphs too', () => {
  // "ight broth" → "Wright brothers"
  assert.deepEqual(snap(body, { p: 0, o: 6 }, { p: 0, o: 16 }), { from: { p: 0, o: 4 }, to: { p: 0, o: 19 } });
  // Backwards and across a paragraph break.
  const across = snap(body, { p: 1, o: 3 }, { p: 0, o: 47 })!;
  assert.equal(quoteOf(body, across.from, across.to), 'flew 36 meters! Few');
  // Only spaces and punctuation: nothing to highlight.
  assert.equal(snap(body, { p: 0, o: 19 }, { p: 0, o: 20 }), null);
});

test('highlighted words run together; the rest stays as it was', () => {
  const highlight: Highlight = {
    id: 'h1',
    from: { p: 0, o: 4 },
    to: { p: 0, o: 19 },
    quote: 'Wright brothers',
    note: '',
    createdAt: '',
  };
  const parts = runs(body[0], 0, [highlight]);
  assert.deepEqual(
    parts.map((run) => [run.highlight, run.pieces.map((piece) => piece.text).join('')]),
    [
      [null, 'The '],
      ['h1', 'Wright brothers'],
      [null, "' plane didn't fly far. It flew 36 meters!"],
    ],
  );
  assert.deepEqual(runs(body[1], 1, [highlight]).length, 1);
});

test('a saved word keeps the sentence it was read in', () => {
  const flew = body[0].indexOf('flew');
  assert.equal(sentenceAt(body[0], flew), 'It flew 36 meters!');
  assert.equal(sentenceAt(body[0], 4), "The Wright brothers' plane didn't fly far.");
  assert.equal(sentenceAt(body[1], 0), body[1]);
  assert.equal(sentenceAt('a '.repeat(200), 0, 20).length, 20);
});
