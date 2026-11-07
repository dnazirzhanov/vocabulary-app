import { type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { button, DEMO, expect, learnerHeaders, test } from './learner.ts';

// My decks without a connection (ADR 0061): made, changed and deleted on the device, kept through
// reloads, and sent once when the connection is back. A production build: the service worker.

const home = (page: Page) => page.getByRole('heading', { level: 1, name: 'Мои колоды' });

async function visitOnline(page: Page) {
  await page.goto('/');
  await expect(home(page)).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => caches.keys().then((names) => names.some((name) => name.startsWith('shell-')))))
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

async function makeDeck(page: Page, title: string) {
  await page.getByRole('button', { name: /Создать колоду/ }).click();
  await page.getByRole('textbox', { name: 'Название новой колоды' }).fill(title);
  await button(page, 'Создать').click();
  await expect(page.getByRole('textbox', { name: 'Название колоды' })).toHaveValue(title);
  await page.getByRole('tab', { name: 'Вручную' }).click();
}

async function addByHand(page: Page, headword: string, translation: string) {
  await page.getByLabel('Слово или выражение').fill(headword);
  await page.getByLabel('Перевод', { exact: true }).fill(translation);
  await page.getByLabel('Пример', { exact: true }).fill(`A ${headword} here.`);
  await button(page, 'Добавить слово').click();
  await expect(page.getByRole('listitem').filter({ hasText: headword }).first()).toBeVisible();
}

/** What the server has of my decks: title → its words' headwords and translations. */
async function onServer(request: APIRequestContext) {
  const decks = (await (await request.get('/api/decks/mine')).json()) as {
    title: string;
    words: { word: { headword: string; translation: string } }[];
  }[];
  return Object.fromEntries(
    decks.map((deck) => [deck.title, deck.words.map(({ word }) => `${word.headword}=${word.translation}`)]),
  );
}

const word = (n: number) => `word${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;

test('a deck and twenty cards made offline survive a reload and arrive once', async ({ page, context }) => {
  await visitOnline(page);
  await context.setOffline(true);
  await makeDeck(page, 'Поездки');
  for (let n = 0; n < 20; n += 1) await addByHand(page, word(n), `слово ${n}`);
  // One corrected, one removed, the deck renamed: all without a connection.
  await page.getByRole('listitem').filter({ hasText: 'wordaa' }).getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Перевод', { exact: true }).fill('исправлено');
  await button(page, 'Сохранить').click();
  await page.getByRole('button', { name: 'Убрать «wordab»' }).click();
  const name = page.getByRole('textbox', { name: 'Название колоды' });
  await name.fill('Путешествия');
  await name.blur();
  await expect(page.getByRole('heading', { level: 1, name: 'Путешествия' })).toBeAttached();
  await expect(page.getByText('Ждёт отправки').first()).toBeVisible();

  // Closed and opened again, still offline: all of it is here.
  await page.reload();
  await expect(home(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Путешествия/ })).toContainText('19');
  expect(await onServer(context.request).catch(() => ({}))).toEqual({});

  await context.setOffline(false);
  // Applied one by one: done when all of them are there.
  await expect.poll(async () => (await onServer(context.request))['Путешествия']?.length, { timeout: 15_000 }).toBe(19);
  const sent = (await onServer(context.request))['Путешествия'];
  expect(sent).toHaveLength(19);
  expect(sent).toContain('wordaa=исправлено');
  expect(sent).not.toContain('wordab=слово 1');
  // Sent again by a second sync (a reload): nothing doubles.
  await page.reload();
  await expect(home(page)).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect((await onServer(context.request))['Путешествия']).toHaveLength(19);
  await expect(page.getByText('Ждёт отправки')).toHaveCount(0);
});

test('a sync cut off midway is finished later, with nothing twice', async ({ page, context }) => {
  await visitOnline(page);
  await context.setOffline(true);
  await makeDeck(page, 'Обрыв');
  for (let n = 0; n < 5; n += 1) await addByHand(page, word(n), `слово ${n}`);
  // The first sending reaches the server, but its answer never comes back.
  let cut = true;
  await page.route('**/api/sync/push', async (route) => {
    if (!cut) return route.continue();
    cut = false;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await context.setOffline(false);
  await expect.poll(() => onServer(context.request), { timeout: 15_000 }).toHaveProperty('Обрыв');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect.poll(async () => (await onServer(context.request))['Обрыв']?.length, { timeout: 15_000 }).toBe(5);
  await expect(page.getByText('Ждёт отправки')).toHaveCount(0);
});

async function secondDevice(context: BrowserContext): Promise<{ device: BrowserContext; other: Page }> {
  const device = await context.browser()!.newContext({ locale: 'ru-RU', extraHTTPHeaders: learnerHeaders(context) });
  return { device, other: await device.newPage() };
}

test('the same card changed on two devices: the second is asked which to keep', async ({ page, context }) => {
  await visitOnline(page);
  await makeDeck(page, 'Общая');
  await addByHand(page, 'apple', 'яблоко');
  await expect.poll(() => onServer(context.request), { timeout: 15_000 }).toHaveProperty('Общая', ['apple=яблоко']);
  const { device, other } = await secondDevice(context);
  await visitOnline(other);
  await other.getByRole('button', { name: 'Изменить «Общая»' }).click();
  await expect(other.getByRole('listitem').filter({ hasText: 'apple' })).toBeVisible();

  await context.setOffline(true);
  await device.setOffline(true);
  for (const [tab, meaning] of [
    [page, 'телефон'],
    [other, 'ноутбук'],
  ] as const) {
    await tab.getByRole('listitem').filter({ hasText: 'apple' }).getByRole('button', { name: 'Изменить' }).click();
    await tab.getByLabel('Перевод', { exact: true }).fill(meaning);
    await button(tab, 'Сохранить').click();
  }
  await context.setOffline(false);
  await expect.poll(() => onServer(context.request), { timeout: 15_000 }).toHaveProperty('Общая', ['apple=телефон']);
  await device.setOffline(false);
  // The laptop's change isn't written over the phone's: it asks.
  const asked = other.getByRole('group', { name: 'На другом устройстве изменено на «телефон».' });
  await expect(asked).toBeVisible({ timeout: 15_000 });
  expect((await onServer(context.request))['Общая']).toEqual(['apple=телефон']);
  await asked.getByRole('button', { name: 'Оставить моё' }).click();
  await expect.poll(() => onServer(context.request), { timeout: 15_000 }).toHaveProperty('Общая', ['apple=ноутбук']);
  await device.close();
});

test("another account on this device never sees this one's unsent decks", async ({ page, context }) => {
  await visitOnline(page);
  // Nothing gets through for now: the deck waits on this device.
  await page.route('**/api/sync/push', (route) => route.abort('connectionreset'));
  await makeDeck(page, 'Только моя');
  await addByHand(page, 'secret', 'тайна');
  await button(page, 'Мои колоды').click();
  await expect(page.getByRole('button', { name: /^Только моя/ })).toBeVisible();

  const me = learnerHeaders(context);
  const someoneElse = `${me['X-Dev-User']}-b`;
  await context.setExtraHTTPHeaders({ ...DEMO, 'X-Dev-User': someoneElse });
  await context.request.patch('/api/me', {
    data: { language: 'ru', name: 'Другой', daily_target_words: 5, study_days_per_week: 6 },
  });
  await page.reload();
  await expect(home(page)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /^Только моя/ })).toHaveCount(0);

  // Back as myself, and connected: my deck is sent, to my account only.
  await context.setExtraHTTPHeaders(me);
  await page.unroute('**/api/sync/push');
  await page.reload();
  await expect
    .poll(() => onServer(context.request), { timeout: 15_000 })
    .toHaveProperty('Только моя', ['secret=тайна']);
  await context.setExtraHTTPHeaders({ ...DEMO, 'X-Dev-User': someoneElse });
  expect(await onServer(context.request)).toEqual({});
});

test('a setting changed offline is kept and sent later', async ({ page, context }) => {
  await visitOnline(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Настройки' }).click();
  const settings = page.getByRole('dialog', { name: 'Настройки' });
  await settings.getByRole('button', { name: /^Имя/ }).click();
  await settings.getByLabel('Имя', { exact: true }).fill('Офлайн');
  await settings.getByRole('button', { name: 'Сохранить' }).click();
  await expect(settings.getByRole('button', { name: /^Имя\s*Офлайн/ })).toBeVisible();
  await page.reload();
  await expect(home(page)).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => ((await (await context.request.get('/api/me')).json()) as { name: string }).name, {
      timeout: 15_000,
    })
    .toBe('Офлайн');
});
