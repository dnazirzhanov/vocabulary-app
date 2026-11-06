import { expect, learnerHeaders, test } from './learner.ts';

test.describe('a new visitor', () => {
  test.use({ locale: 'ky-KG' });

  test("sees the device's language, in the page itself too", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Менин топтомдорум' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ky');
    await expect(page.getByRole('button', { name: /Достор/ }).first()).toBeVisible();
  });
});

test('the language is changed in settings, stays after a reload and follows the account', async ({
  page,
  browser,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Настройки' }).first().click();
  await page.getByLabel('Язык приложения').selectOption('en');
  await expect(page.getByRole('heading', { level: 1, name: 'My decks' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'My decks' })).toBeVisible();

  // The same person on another device, which would otherwise show Russian.
  const other = await browser.newContext({
    locale: 'ru-RU',
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: learnerHeaders(context),
  });
  const phone = await other.newPage();
  await phone.goto('/');
  await expect(phone.getByRole('heading', { level: 1, name: 'My decks' })).toBeVisible();
  await other.close();
});

for (const language of ['ru', 'uz', 'kk', 'ky', 'tg', 'en']) {
  test(`${language}: nothing runs off a small phone's screen`, async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await context.request.patch('/api/me', { data: { ui_language: language } });
    const deck = await (await context.request.post('/api/decks', { data: { title: 'Travel' } })).json();
    await context.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword: 'luggage', translation: 'багаж', pos: 'noun', example: 'My luggage is heavy.' },
    });
    const group = await (await context.request.post('/api/groups', { data: { name: '7B', nickname: 'Anna' } })).json();

    const fits = async (where: string) => {
      await page.waitForLoadState('networkidle');
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(over, where).toBeLessThanOrEqual(0);
    };
    const screens = ['home', 'friends', 'group', 'progress', 'deck'];
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await fits(screens[0]);
    const nav = page.getByRole('navigation').first().getByRole('button');
    await nav.nth(1).click();
    await fits(screens[1]);
    await page.getByRole('button', { name: new RegExp(`^${group.name}`) }).click();
    await fits(screens[2]);
    await nav.nth(2).click();
    await fits(screens[3]);
    await nav.nth(0).click();
    await page
      .getByRole('button', { name: /Travel/ })
      .first()
      .click();
    await fits(screens[4]);
  });
}
