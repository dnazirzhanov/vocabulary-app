import { button, expect, openDeck, study, test } from './learner.ts';

// Each new card says its word once (ADR 0013). The app runs in React's development mode here,
// which sets every screen up twice: the first card used to be heard twice.

test('each card says its word once, the first card included', async ({ page }) => {
  await page.addInitScript(() => {
    const played: string[] = [];
    (window as unknown as { played: string[] }).played = played;
    HTMLMediaElement.prototype.play = function () {
      played.push(decodeURIComponent(new URL(this.currentSrc || this.src).pathname));
      return Promise.resolve();
    };
  });
  const played = () => page.evaluate(() => (window as unknown as { played: string[] }).played);
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500); // room for a second, unwanted play
  const first = await played();
  expect(first).toHaveLength(1);
  expect(first[0]).toMatch(/^\/audio\/words\/.+\.mp3$/);

  // The next card says its own word, once.
  await study(page, 'Хорошо');
  await expect.poll(async () => (await played()).length).toBe(2);
  await page.waitForTimeout(500);
  const both = await played();
  expect(both).toHaveLength(2);
  expect(both[1]).not.toBe(both[0]);
});
