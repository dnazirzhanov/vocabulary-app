import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

interface Learner {
  /** Moves the server clock (development only) so "come back tomorrow" needs no waiting. */
  travelTo: (moment: Date) => Promise<void>;
}

const learnerId = new WeakMap<BrowserContext, string>();

/** Every test is a brand-new learner, so tests never share progress and can run in parallel. */
export const test = base.extend<{ learner: Learner; onboarded: boolean }>({
  // `test.use({ onboarded: false })` starts as a learner who has not chosen a pace yet.
  onboarded: [true, { option: true }],
  context: async ({ context, onboarded }, use) => {
    const id = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    learnerId.set(context, id);
    await context.setExtraHTTPHeaders({ 'X-Dev-User': id });
    // Past the first-run screens with the default pace (5 words a day); e2e/goal.spec.ts covers them.
    if (onboarded) {
      await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
    }
    await use(context);
  },
  learner: async ({ context }, use) => {
    await use({
      travelTo: (moment) =>
        context.setExtraHTTPHeaders({ 'X-Dev-User': learnerId.get(context)!, 'X-Dev-Now': moment.toISOString() }),
    });
  },
});
export { expect };

export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

export type RatingLabel = 'Снова' | 'Трудно' | 'Хорошо' | 'Легко';

/** Studies the card on screen: shows the answer, rates it, and waits for the next card. */
export async function study(page: Page, rating: RatingLabel = 'Хорошо') {
  const card = page.locator('[data-card]');
  const id = await card.getAttribute('data-card');
  await button(page, 'Показать ответ').click();
  await page.getByRole('button', { name: new RegExp(`^${rating}`) }).click();
  // The next card replaces this one, or the summary appears.
  await expect(page.locator(`[data-card="${id}"]`)).toHaveCount(0);
}

/** Studies every card until the summary, rating each card's first showing as given (by headword). */
export async function finishSession(page: Page, ratings: Record<string, RatingLabel> = {}) {
  const seen = new Set<string>();
  const summary = page.getByRole('button', { name: 'На главную' });
  while (!(await summary.isVisible())) {
    const word = page.getByRole('heading', { level: 1 });
    await expect(word.or(summary).first()).toBeVisible();
    if (await summary.isVisible()) break;
    const headword = (await word.textContent())!;
    await study(page, seen.has(headword) ? 'Хорошо' : (ratings[headword] ?? 'Хорошо'));
    seen.add(headword);
  }
}
