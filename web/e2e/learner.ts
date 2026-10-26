import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

const wordsFile = fileURLToPath(new URL('../../content/starter-deck/words.yaml', import.meta.url));

// The deck format is ours, so headword and translation can be read without a YAML parser.
const translationOf: Record<string, string> = {};
for (const entry of readFileSync(wordsFile, 'utf8')
  .split(/^- id: /m)
  .slice(1)) {
  const headword = entry.match(/^ {2}headword: (.+)$/m)![1].trim();
  translationOf[headword] = entry.match(/^ {2}translation: (.+)$/m)![1].trim();
}
const headwordFor = Object.fromEntries(Object.entries(translationOf).map(([h, t]) => [t, h]));

interface Learner {
  /** Moves the server clock (development only) so "come back tomorrow" needs no waiting. */
  travelTo: (moment: Date) => Promise<void>;
}

const learnerId = new WeakMap<BrowserContext, string>();

/** Every test is a brand-new learner, so tests never share progress and can run in parallel. */
export const test = base.extend<{ learner: Learner }>({
  context: async ({ context }, use) => {
    const id = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    learnerId.set(context, id);
    await context.setExtraHTTPHeaders({ 'X-Dev-User': id });
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

/** Answers whatever exercise is on screen, correctly unless told otherwise, and moves on. */
export async function answer(page: Page, { correct = true, stopOnFeedback = false } = {}) {
  const card = page.locator('[data-type]');
  const type = await card.getAttribute('data-type');
  const heading = page.getByRole('heading', { level: 1 });
  if (type === 'introduce') {
    // The card stays until the server acknowledges it; wait until the next exercise replaces it.
    const current = await card.elementHandle();
    await button(page, 'Дальше').click();
    await page.waitForFunction((element) => !element?.isConnected, current);
    return;
  }
  if (type === 'recall_meaning') {
    await expect(page.getByText('Вспомните перевод')).toBeVisible();
    await button(page, 'Показать варианты').click();
  }
  if (type === 'choose_meaning' || type === 'recall_meaning') {
    const right = translationOf[(await heading.textContent())!];
    const option = page.getByRole('radio', { name: correct ? right : undefined });
    if (correct) await option.click();
    else await page.locator('label', { hasNotText: right }).first().click();
  } else {
    const translation = (await heading.textContent())!.replace(/\s*(сущ|гл|прил|нар)\.$/, '').trim();
    const word = headwordFor[translation];
    await page.getByRole('textbox').fill(correct ? word : `${word}x`);
  }
  await button(page, 'Проверить').click();
  await expect(button(page, 'Продолжить')).toBeVisible();
  if (!stopOnFeedback) await button(page, 'Продолжить').click();
}
