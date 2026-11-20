import { expect, test } from './learner.ts';
import { openMentorPlan } from './mentorNav.ts';

/**
 * Whether the mentor works (ADR 0078): «Начать» is counted, and counting is never in the way —
 * if it fails, the practice starts all the same.
 */
test.use({ mentor: true, viewport: { width: 390, height: 844 } });

async function openMentor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await openMentorPlan(page);
}

test('«Начать» on the home is counted, with where it was tapped', async ({ page }) => {
  await openMentor(page);
  const start = page.getByRole('region', { name: 'Сейчас' }).getByRole('button', { name: 'Начать сейчас' });
  if (!(await start.isVisible())) test.skip(true, 'nothing to start for this learner now');
  const counted = page.waitForRequest((r) => r.url().endsWith('/api/mentor/events') && r.method() === 'POST');
  await start.click();
  const body = (await counted).postDataJSON() as { name: string; where: string; kind: string };
  expect(body).toMatchObject({ name: 'start_tapped', where: 'home' });
});

test('if counting fails, the practice starts anyway', async ({ page }) => {
  await page.route('**/api/mentor/events', (route) => route.abort());
  await openMentor(page);
  const start = page.getByRole('region', { name: 'Сейчас' }).getByRole('button', { name: 'Начать сейчас' });
  if (!(await start.isVisible())) test.skip(true, 'nothing to start for this learner now');
  await start.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Сейчас' })).toHaveCount(0);
});
