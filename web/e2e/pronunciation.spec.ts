import { button, expect, test } from './learner.ts';

/**
 * One voice for every word (ADR 0070): a teacher's own word has no recorded file, so the app asks
 * the server's voice for it (mocked here; the endpoint is tested in the backend) instead of letting
 * each phone speak it its own way.
 */

/** A tenth of a second of silence as a WAV: something real for the player to load. */
function silence(): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(rate / 5);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test("a teacher's own word is spoken by the app's voice, not the phone's", async ({ page, context }) => {
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Путешествия' } })).json();
  await context.request.post(`/api/decks/${deck.id}/words`, {
    data: { headword: 'luggage', pos: 'noun', translation: 'багаж', example: 'My luggage is heavy.' },
  });
  const asked: string[] = [];
  await page.route('**/api/pronunciation?*', (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({ body: silence(), contentType: 'audio/wav' });
  });
  // Count what the device's own voice is asked to say: nothing, if the app's voice answers.
  await page.addInitScript(() => {
    const w = window as unknown as { deviceSpoke: string[] };
    w.deviceSpoke = [];
    speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.deviceSpoke.push(u.text);
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Путешествия/ }).click();
  await page.getByRole('button', { name: /^Все слова колоды/ }).click();
  await button(page, 'Послушать: luggage').click();
  await expect.poll(() => asked).toEqual(['?kind=word&text=luggage']);
  expect(await page.evaluate(() => (window as unknown as { deviceSpoke: string[] }).deviceSpoke)).toEqual([]);

  // Asked once: a second tap plays what it already has.
  await button(page, 'Послушать: luggage').click();
  await page.waitForTimeout(300);
  expect(asked).toHaveLength(1);
});
