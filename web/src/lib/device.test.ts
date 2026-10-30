import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAppleMobile, keyBytes } from './device.ts';

test('the server key becomes the bytes a browser subscribes with', () => {
  // A base64url key without padding: "-" and "_" stand for "+" and "/".
  assert.deepEqual([...keyBytes('BP-_AQ')], [4, 255, 191, 1]);
});

test('iPhones and iPads are recognised, iPads in their Mac disguise too', () => {
  assert.equal(isAppleMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), true);
  assert.equal(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true);
  assert.equal(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false);
  assert.equal(isAppleMobile('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5), false);
});
