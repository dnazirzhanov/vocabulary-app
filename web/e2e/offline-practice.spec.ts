import { type Page } from '@playwright/test';
import { button, expect, study, test } from './learner.ts';

// «Повторить сейчас»: words already met, gone over whenever one likes, on the device. It never
// changes when they come back: the server keeps the schedule as it was (a `hard` session).

const home = (page: Page) => page.getByRole('heading', { level: 1, name: 'Мои колоды' });

/** When each word of mine comes back, as the server has it. */
async function dueDates(page: Page): Promise<Record<string, string>> {
  const pack = await (await page.request.get(`/api/study/pack?device_id=${crypto.randomUUID()}`)).json();
  return Object.fromEntries(pack.progress.map((row: unknown[]) => [row[0], row[5]]));
}

async function lessonWords(page: Page): Promise<string[]> {
  const words: string[] = [];
  const summary = page.getByRole('button', { name: 'На главную' });
  for (;;) {
    await expect(page.locator('[data-card]').or(summary).first()).toBeVisible();
    if (await summary.isVisible()) return words;
    words.push((await page.locator('[data-card] h1').textContent())!);
    await study(page, 'Снова');
  }
}

test('after today’s words, «Повторить сейчас» goes over them again and changes nothing', async ({ page }) => {
  const deck = await (await page.request.post('/api/decks', { data: { title: 'Поездка' } })).json();
  for (const headword of ['ticket', 'hotel', 'airport']) {
    await page.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, pos: 'noun', translation: `перевод ${headword}`, example: `A ${headword} here.` },
    });
  }
  await page.goto('/');
  await expect(home(page)).toBeVisible();
  await page.getByRole('button', { name: /^Поездка/ }).click();
  await button(page, 'Начать урок · 3 слова').click();
  const summary = page.getByRole('button', { name: 'На главную' });
  for (;;) {
    await expect(page.locator('[data-card]').or(summary).first()).toBeVisible();
    if (await summary.isVisible()) break;
    await study(page, 'Хорошо');
  }
  await summary.click();
  await expect.poll(async () => Object.keys(await dueDates(page)).length).toBe(3);
  const before = await dueDates(page);

  // Nothing left today: the main button offers practice; all three, even answered «Снова».
  await button(page, 'Повторить сейчас').click();
  const dialog = page.getByRole('dialog', { name: 'Повторить сейчас' });
  await dialog.getByRole('button', { name: 'Все · 3' }).click();
  await dialog.getByRole('button', { name: 'Начать · 3 слова' }).click();
  expect(new Set(await lessonWords(page))).toEqual(new Set(['ticket', 'hotel', 'airport']));

  // Sent to the server, and when each word comes back is as it was.
  await expect
    .poll(async () => (await (await page.request.get('/api/progress')).json()).today?.cards ?? 0)
    .toBeGreaterThan(3);
  expect(await dueDates(page)).toEqual(before);
});
