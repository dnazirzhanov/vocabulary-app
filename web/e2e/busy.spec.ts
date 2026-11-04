import { button, expect, test } from './learner.ts';

const BUSY = { status: 503, json: { error: { code: 'server_busy', message: 'Try again in a moment' } } };

// A server at its limit refuses at once (ADR 0044); the learner should barely notice.
test('a busy server is tried again without the learner seeing an error', async ({ page }) => {
  let refused = 0;
  await page.route('**/api/decks/library', (route) => {
    if (refused < 2) {
      refused += 1;
      return route.fulfill(BUSY);
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await expect(button(page, 'Открыть курс')).toBeVisible({ timeout: 15_000 });
  expect(refused).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a server that stays busy says so, in words', async ({ page }) => {
  await page.route('**/api/decks/library', (route) => route.fulfill(BUSY));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('очень много учеников', { timeout: 20_000 });
});
