import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

interface Learner {
  /** Moves the server clock (development only) so "come back tomorrow" needs no waiting. */
  travelTo: (moment: Date) => Promise<void>;
}

const learnerId = new WeakMap<BrowserContext, string>();
/** Drafting decks uses the demo, never a real model, even when the dev server holds a key. */
export const DEMO = { 'X-Dev-Generation': 'demo' };

/** Every test is a brand-new learner, so tests never share progress and can run in parallel. */
export const test = base.extend<{ learner: Learner; onboarded: boolean }>({
  // `test.use({ onboarded: false })` starts as a learner who has not chosen a pace yet.
  onboarded: [true, { option: true }],
  context: async ({ context, onboarded }, use) => {
    const id = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    learnerId.set(context, id);
    await context.setExtraHTTPHeaders({ 'X-Dev-User': id, ...DEMO });
    // Past the first-run screens with the default pace (5 words a day); e2e/goal.spec.ts covers them.
    if (onboarded) {
      await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
    }
    await use(context);
  },
  learner: async ({ context }, use) => {
    await use({
      travelTo: (moment) =>
        context.setExtraHTTPHeaders({
          'X-Dev-User': learnerId.get(context)!,
          'X-Dev-Now': moment.toISOString(),
          ...DEMO,
        }),
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
 * Builds the word of the spelling card on screen (typed: letters pick tiles), checks it and moves
 * on. The card shows only the meaning; the word is known from the flashcards earlier in the test.
 * `answer` builds something else instead (a mistake).
 */
export async function spell(page: Page, answer?: string) {
  const exercise = page.locator('[data-spelling]');
  const id = await exercise.getAttribute('data-spelling');
  const meaning = (await exercise.locator('[data-translation]').textContent())!.trim();
  const word = meanings(page).get(meaning);
  if (!word) throw new Error(`no word known for «${meaning}»`);
  await page.keyboard.type(answer ?? word);
  await button(page, 'Проверить').click();
  await button(page, 'Дальше').click();
  await expect(page.locator(`[data-spelling="${id}"]`)).toHaveCount(0);
}

/** Today's spelling (ADR 0016), from the button on home or on a lesson's summary, to its end. */
export async function spellToday(page: Page, misspell: Record<string, string> = {}) {
  await page
    .getByRole('button', { name: /^Правописание · / })
    .first()
    .click();
  await finishSession(page, {}, misspell);
}

/**
 * Finishes the session: each card's first showing rated as given (by headword, default
 * «Хорошо»); each spelling card built right — or, for a word in `misspell`, built that way.
 */
export async function finishSession(
  page: Page,
  ratings: Record<string, RatingLabel> = {},
  misspell: Record<string, string> = {},
) {
  const seen = new Set<string>();
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
      await spell(page, word ? misspell[word] : undefined);
      continue;
    }
    const headword = (await card.getByRole('heading', { level: 1 }).textContent())!;
    await study(page, seen.has(headword) ? 'Хорошо' : (ratings[headword] ?? 'Хорошо'));
    seen.add(headword);
  }
}
