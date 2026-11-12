import { type APIRequestContext, type Page } from '@playwright/test';
import { button, DEMO, expect, learnerHeaders, test } from './learner.ts';

// Reading Mode offline (docs/product/reading-mode-architecture.md): an article opened once is kept
// by the service worker and opens again without a connection, where I stopped. A production build.

test.use({ reader: true });

/** My decks on the server: title → "headword=translation" of each card. */
async function onServer(request: APIRequestContext) {
  const decks = (await (await request.get('/api/decks/mine')).json()) as {
    title: string;
    words: { word: { headword: string; translation: string } }[];
  }[];
  return Object.fromEntries(
    decks.map((deck) => [deck.title, deck.words.map(({ word }) => `${word.headword}=${word.translation}`)]),
  );
}

async function openMars(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Наука/ }).click();
  await page.getByRole('button', { name: /^Why Is Mars Red/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Why Is Mars Red?' })).toBeVisible();
}

async function visitOnline(page: Page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

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

test("a word kept offline is in the article's deck on the server once online", async ({ page, context }) => {
  await visitOnline(page);
  await openMars(page);
  await context.setOffline(true);
  await page.locator('article [data-f="planet"]').first().click();
  await button(page, 'Добавить в слова').click();
  await expect(button(page, 'Учить · 1')).toBeVisible();
  expect(await onServer(context.request)).toEqual({});

  await context.setOffline(false);
  await expect
    .poll(() => onServer(context.request), { timeout: 15_000 })
    .toEqual({ 'Why Is Mars Red?': ['planet=планета'] });
  // It says which reading it came from, so home lists it under «Из чтения».
  const library = await (await context.request.get('/api/decks/library')).json();
  expect(library.mine.map((deck: { reading_ref: string }) => deck.reading_ref)).toEqual(['library:mars-red-color']);
});

test("another account on this device never sees this one's reading words", async ({ page, context }) => {
  await visitOnline(page);
  await openMars(page);
  await page.locator('article [data-f="dust"]').first().click();
  await button(page, 'Добавить в слова').click();
  await expect(button(page, 'Учить · 1')).toBeVisible();
  await expect.poll(() => onServer(context.request), { timeout: 15_000 }).toHaveProperty('Why Is Mars Red?');

  // Someone else signs in on the same phone: no words in the article, no deck of mine.
  const me = learnerHeaders(context);
  await context.setExtraHTTPHeaders({ ...DEMO, 'X-Dev-User': `${me['X-Dev-User']}-b` });
  await context.request.patch('/api/me', {
    data: { language: 'ru', name: 'Другой', daily_target_words: 5, study_days_per_week: 6 },
  });
  await page.goto('/');
  await openMars(page);
  await expect(page.getByRole('button', { name: 'Слова из статьи: 0' })).toBeVisible();
  await page.locator('article [data-f="dust"]').first().click();
  await expect(button(page, 'Добавить в слова')).toBeVisible();
  expect(await onServer(context.request)).toEqual({});
});

test('a text of my own opened once opens offline, its meanings too', async ({ page, context }) => {
  const text = 'My grandmother showed me how to bake bread in an old oven.';
  await page.request.post('/api/readings', { data: { title: 'The oven', text } });
  await visitOnline(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Мои тексты/ }).click();
  await page.getByRole('button', { name: /^The oven/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The oven' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Мои тексты/ }).click();
  await page.getByRole('button', { name: /^The oven/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The oven' })).toBeVisible();
  await page.locator('article [data-f="oven"]').click();
  await expect(page.getByRole('region', { name: 'oven' })).toContainText('перевод «oven» (демо)');
});

test('an answer written offline stays on the phone and reaches the server once online', async ({ page, context }) => {
  await visitOnline(page);
  await openMars(page);
  await context.setOffline(true);
  const box = page.getByRole('textbox', { name: /What does this suggest about Mars long ago/ });
  const answer =
    'It suggests that Mars once had a lot of liquid water, because ferrihydrite forms in water-rich places. That matters to scientists who look for life, because life as we know it needs water, so old wet places on Mars are good places to search.';
  await box.fill(answer);
  const item = page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(3);
  await item.getByRole('button', { name: 'Отправить' }).click();
  await expect(item).toContainText(answer);

  // A reload offline: still there.
  await page.reload();
  await openMars(page);
  await expect(page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(3)).toContainText(
    answer,
  );

  await context.setOffline(false);
  await expect
    .poll(
      async () =>
        (await (await context.request.get('/api/reading-answers?reading=library%3Amars-red-color')).json()).map(
          (one: { text: string }) => one.text,
        ),
      { timeout: 15_000 },
    )
    .toEqual([answer]);
});
