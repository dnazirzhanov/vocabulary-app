import { expect, test } from './learner.ts';

// Reading Mode offline (docs/product/reading-mode-architecture.md): an article opened once is kept
// by the service worker and opens again without a connection, where I stopped. A production build.

test.use({ reader: true });

test('an article read once opens offline, back where I stopped', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Наука/ }).click();
  await page.getByRole('button', { name: /^Why Is Mars Red/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Why Is Mars Red?' })).toBeVisible();

  // Read down to a later paragraph; progress is written within a second.
  const paragraph = page.locator('article p[data-i="10"]');
  await paragraph.scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('reading-progress:'))))
    .toBe(true);
  await page.waitForTimeout(1200);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Наука/ }).click();
  await expect(page.getByRole('button', { name: /^Why Is Mars Red/ })).toBeVisible();
  await page.getByRole('button', { name: /^Why Is Mars Red/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Why Is Mars Red?' })).toBeVisible();
  // Back where I stopped: a later paragraph is on screen, not the title.
  await expect(page.locator('article p[data-i="10"]')).toBeInViewport();
});
