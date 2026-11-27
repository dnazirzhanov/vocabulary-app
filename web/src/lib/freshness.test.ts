import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOf, isNewer } from './freshness.ts';

const PAGE = (main: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="/assets/${main}"></script>` +
  `<link rel="stylesheet" href="/assets/index-Bx1.css"></head><body></body></html>`;

test('the build is the main script named in the page', () => {
  assert.equal(buildOf(PAGE('index-j2-PbyeZ.js')), 'index-j2-PbyeZ.js');
  assert.equal(buildOf('/assets/index-CYxqQ-sx.js'), 'index-CYxqQ-sx.js');
  assert.equal(buildOf('<html>offline</html>'), null);
});

test('only a different build, known on both sides, is newer', () => {
  assert.equal(isNewer('index-a.js', 'index-b.js'), true);
  assert.equal(isNewer('index-a.js', 'index-a.js'), false);
  assert.equal(isNewer(null, 'index-b.js'), false);
  assert.equal(isNewer('index-a.js', null), false);
});
