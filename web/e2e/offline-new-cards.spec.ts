import { type Page } from '@playwright/test';
import { button, expect, study, test } from './learner.ts';

// Cards added to one's own deck can be studied at once (found in the owner's phone test): the study
// pack, which lessons are planned from, follows the deck's changes; a card not yet on the server is
// said, not hidden behind "nothing new". A production build: the outbox, the pack, offline.

const home = (page: Page) => page.getByRole('heading', { level: 1, name: 'Мои колоды' });

async function visitOnline(page: Page) {
  await page.goto('/');
  await expect(home(page)).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForLoadState('networkidle');
}

/** A deck of my own with these words, made through the API (the server has it at once). */
async function deckWith(page: Page, title: string, headwords: string[]) {
  const deck = await (await page.request.post('/api/decks', { data: { title } })).json();
  for (const headword of headwords) {
    const added = await page.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, pos: 'noun', translation: `перевод ${headword}`, example: `A ${headword} here.` },
    });
    expect(added.ok()).toBe(true);
  }
}

async function openEditor(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Изменить «${title}»` }).click();
  await page.getByRole('tab', { name: 'Вручную' }).click();
}

async function addByHand(page: Page, headword: string) {
  await page.getByLabel('Слово или выражение').fill(headword);
  await page.getByLabel('Перевод', { exact: true }).fill(`перевод ${headword}`);
  await page.getByLabel('Пример', { exact: true }).fill(`A ${headword} here.`);
  await button(page, 'Добавить слово').click();
  await expect(page.getByRole('listitem').filter({ hasText: headword }).first()).toBeVisible();
}

/** Studies the lesson on screen to its end; returns the words it showed. */
async function lessonWords(page: Page): Promise<Set<string>> {
  const words = new Set<string>();
  const summary = page.getByRole('button', { name: 'На главную' });
  for (;;) {
    await expect(page.locator('[data-card]').or(summary).first()).toBeVisible();
    if (await summary.isVisible()) return words;
    words.add((await page.locator('[data-card] h1').textContent())!);
    await study(page, 'Хорошо');
  }
}

test('cards added to a deck whose words are all met are in the very next lesson', async ({ page }) => {
  await deckWith(page, 'Поездка', ['ticket', 'hotel', 'airport']);
  await visitOnline(page);
  await openEditor(page, 'Поездка');
  await button(page, 'Учить · 3 слова').click();
  expect(await lessonWords(page)).toEqual(new Set(['ticket', 'hotel', 'airport']));

  // Two more cards, then study at once: those two, not "nothing new".
  await openEditor(page, 'Поездка');
  await addByHand(page, 'suitcase');
  await addByHand(page, 'passport');
  await button(page, 'Учить · 5 слов').click();
  expect(await lessonWords(page)).toEqual(new Set(['suitcase', 'passport']));
});

test('a card added offline is said to be waiting, and is in the lesson once online', async ({ page, context }) => {
  await deckWith(page, 'Поездка', ['ticket', 'hotel']);
  await visitOnline(page);
  await openEditor(page, 'Поездка');
  await button(page, 'Учить · 2 слова').click();
  await lessonWords(page);

  await openEditor(page, 'Поездка');
  await context.setOffline(true);
  await addByHand(page, 'luggage');
  await button(page, 'Учить · 3 слова').click();
  await expect(page.getByRole('alert')).toContainText(
    'Новые карточки ещё не дошли до сервера. Подключитесь к интернету — и они появятся в уроке.',
  );

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await button(page, 'Учить · 3 слова').click();
  expect(await lessonWords(page)).toEqual(new Set(['luggage']));
});
