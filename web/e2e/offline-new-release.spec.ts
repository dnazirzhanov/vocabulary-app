import { expect, test } from './learner.ts';

// A tab left open picks up a new release (web/src/lib/freshness.ts). Only a production build has
// builds to compare, so this runs in the offline project's build. The service worker is kept out:
// these tests answer the page's own requests, which a worker would answer from its cache.

test.use({ serviceWorkers: 'block' });

/** A mark on the page that a reload wipes. */
const mark = () => (window as unknown as { __kept?: boolean }).__kept;

test('a newer release loads at the next tab change, which then opens', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Прогресс' })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __kept?: boolean }).__kept = true;
  });
  // The server now has another build.
  await page.route('**/?build=*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><script type="module" src="/assets/index-NEWER123.js"></script>',
    }),
  );
  const asked = page.waitForRequest('**/?build=*');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await asked;

  await page.getByRole('navigation').getByRole('button', { name: 'Прогресс' }).click();
  await expect.poll(() => page.evaluate(mark)).toBeUndefined();
  // The reloaded page opens the tab chosen.
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Прогресс' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the same release: changing tabs reloads nothing', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { __kept?: boolean }).__kept = true;
  });
  const asked = page.waitForRequest('**/?build=*');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await (await asked).response();
  await page.getByRole('navigation').getByRole('button', { name: 'Прогресс' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Сегодня' }).click();
  expect(await page.evaluate(mark)).toBe(true);
});

test('a screen whose file is gone (an older build) reloads the page once, not again and again', async ({ page }) => {
  let loads = 0;
  page.on('load', () => (loads += 1));
  await page.route('**/assets/PlannerScreen-*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Планы' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  await expect.poll(() => loads).toBe(2);
  // Still gone after the reload: no loop.
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  await page.waitForTimeout(1500);
  expect(loads).toBe(2);
});
