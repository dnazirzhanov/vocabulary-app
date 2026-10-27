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

/** Words seen in this test, by their Russian meaning: a spelling recall shows only the meaning. */
const wordsByMeaning = new WeakMap<Page, Map<string, string>>();
const meanings = (page: Page) => {
  if (!wordsByMeaning.has(page)) wordsByMeaning.set(page, new Map());
  return wordsByMeaning.get(page)!;
};

/** Studies the card on screen: shows the answer, rates it, and waits for the next card. */
export async function study(page: Page, rating: RatingLabel = 'Хорошо') {
  const card = page.locator('[data-card]');
  const id = await card.getAttribute('data-card');
  await button(page, 'Показать ответ').click();
  const headword = (await card.getByRole('heading', { level: 1 }).textContent())!;
  meanings(page).set((await card.locator('[data-translation]').textContent())!.trim(), headword);
  await page.getByRole('button', { name: new RegExp(`^${rating}`) }).click();
  // The next card replaces this one, or the summary appears.
  await expect(page.locator(`[data-card="${id}"]`)).toHaveCount(0);
}

/**
 * Builds the word of the spelling exercise on screen (typed: letters pick tiles), checks it and
 * moves on. Guided shows the word; a recall's word is known from earlier in the test. `answer`
 * builds something else instead (a recall the learner gets wrong).
 */
export async function spell(page: Page, answer?: string) {
  const exercise = page.locator('[data-spelling]');
  const id = await exercise.getAttribute('data-spelling');
  const meaning = (await exercise.locator('[data-translation]').textContent())!.trim();
  const shown = exercise.locator('h1[lang="en"]');
  const word = (await shown.count()) ? (await shown.textContent())! : meanings(page).get(meaning);
  if (!word) throw new Error(`no word known for «${meaning}»`);
  meanings(page).set(meaning, word);
  await page.keyboard.type(answer ?? word);
  await button(page, 'Проверить').click();
  const next = page.getByRole('button', { name: /^(Дальше|Потренировать написание|Собрать правильно)$/ });
  if ((await next.textContent()) === 'Собрать правильно') {
    await next.click();
    await page.keyboard.type(word);
  }
  await page.getByRole('button', { name: /^(Дальше|Потренировать написание)$/ }).click();
  await expect(page.locator(`[data-spelling="${id}"]`)).toHaveCount(0);
}

/**
 * Finishes the lesson: each card's first showing rated as given (by headword, default «Хорошо»),
 * then the spelling built right — or, for a word in `misspell`, its first recall built that way.
 */
export async function finishSession(
  page: Page,
  ratings: Record<string, RatingLabel> = {},
  misspell: Record<string, string> = {},
) {
  const seen = new Set<string>();
  const recalled = new Set<string>();
  // The lesson first: the screen it was started from may have its own «На главную».
  await expect(page.getByRole('button', { name: 'Выйти из урока' })).toBeVisible();
  const summary = page.getByRole('button', { name: 'На главную' });
  const card = page.locator('[data-card]');
  const spelling = page.locator('[data-spelling]');
  while (!(await summary.isVisible())) {
    // The next card's front, a spelling exercise, or the summary. The last answered exercise
    // lingers for a moment while the lesson is completed, so wait for something to answer.
    await expect(button(page, 'Показать ответ').or(button(page, 'Проверить')).or(summary).first()).toBeVisible();
    if (await summary.isVisible()) break;
    if (await spelling.count()) {
      const meaning = (await spelling.locator('[data-translation]').textContent())!.trim();
      const word = meanings(page).get(meaning);
      const isRecall = (await spelling.locator('h1[lang="en"]').count()) === 0;
      const wrong = word && isRecall && !recalled.has(word) ? misspell[word] : undefined;
      if (word && isRecall) recalled.add(word);
      await spell(page, wrong);
      continue;
    }
    const headword = (await card.getByRole('heading', { level: 1 }).textContent())!;
    await study(page, seen.has(headword) ? 'Хорошо' : (ratings[headword] ?? 'Хорошо'));
    seen.add(headword);
  }
}
