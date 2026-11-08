import { expect, learnerHeaders, test, named } from './learner.ts';

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
  await page.getByRole('button', { name: /Язык приложения/ }).click();
  await page.getByRole('radio', { name: 'English' }).click();
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

test.describe('a new learner who knows only Kyrgyz', () => {
  test.use({ onboarded: false, languageChosen: false, named: null, locale: 'ru-RU' });

  // The app saves the device's language for a new account; on a slow network that save once
  // landed after the learner's own choice and turned the app back to Russian.
  test('a quick first choice is kept, however slowly the app saves its own', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown> | null;
      if (route.request().method() === 'PATCH' && body && Object.keys(body).join() === 'ui_language') {
        // Reaches the server late, even if the page has moved on meanwhile.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const late = await route.fetch();
        return route.fulfill({ response: late }).catch(() => undefined);
      }
      await route.continue();
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Кыргызча' }).click();
    await expect(page.getByRole('heading', { name: 'Атыңыз ким?' })).toBeVisible();
    await page.waitForTimeout(2000); // past any save still on its way
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Атыңыз ким?' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ky');
  });

  test('chooses it first, then studies a whole deck without a Russian word', async ({ page }) => {
    await page.route('**/api/push/key', (route) => route.fulfill({ json: { public_key: null } }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'На каком языке вы хотите учить английский?' })).toBeFocused();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(5);
    await page.getByRole('button', { name: 'Кыргызча' }).click();

    // Then the name, already in the language chosen (ADR 0057).
    await expect(page.getByRole('heading', { name: 'Атыңыз ким?' })).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ky');
    await page.getByLabel('Ат', { exact: true }).fill('Айгүл');
    await page.getByRole('button', { name: 'Кийинки' }).click();

    await expect(page.getByRole('heading', { name: 'Күнүнө канча жаңы сөз?' })).toBeFocused();
    await page.getByRole('button', { name: /^5\sсөз$/ }).click();
    await page.getByRole('button', { name: 'Баштоо', exact: true }).click();

    // No course: it is in Russian.
    await expect(page.getByRole('heading', { level: 1, name: 'Менин топтомдорум' })).toBeVisible();
    await expect(page.getByText('Деңгээлдер боюнча англис тили')).toHaveCount(0);
    const clean = async (where: string) => {
      await page.waitForLoadState('networkidle');
      const text = await page.locator('body').innerText();
      // Russian-only words a slip would show; Kyrgyz shares the rest of the alphabet.
      expect(text, where).not.toMatch(/Загружаем|Сохранить|Мои колоды|Сегодня|перевод|Создать|Повторить|Английск/);
    };
    await clean('home');

    // Cards made with AI: the language is chosen right beside their level, and starts as mine.
    await page.getByRole('button', { name: /Топтом түзүү/ }).click();
    await page.getByLabel('Жаңы топтомдун аты').fill('Сапар');
    await page.getByRole('button', { name: 'Түзүү', exact: true }).click();
    await page.getByRole('tab', { name: 'Сөздөр' }).click();
    const language = page.getByLabel('Котормо тили');
    await expect(language).toHaveValue('ky');
    await clean('editor');
    await page.getByLabel('Карточкалар үчүн сөздөр').fill('house');
    await page.getByRole('button', { name: /Карточка түзүү/ }).click();
    await expect(page.getByText('«house» котормосу (демо)')).toBeVisible();

    // Another batch in another language, and the choice holds on the other tabs.
    await language.selectOption('kk');
    await page.getByLabel('Карточкалар үчүн сөздөр').fill('river');
    await page.getByRole('button', { name: /Карточка түзүү/ }).click();
    await expect(page.getByText('«river» аудармасы (демо)')).toBeVisible();
    await page.getByRole('tab', { name: 'Тема' }).click();
    await expect(page.getByLabel('Котормо тили')).toHaveValue('kk');
    await page.getByRole('tab', { name: 'Текст' }).click();
    await expect(page.getByLabel('Котормо тили')).toHaveValue('kk');
    await page.getByRole('tab', { name: 'Кол менен' }).click();
    await expect(page.getByLabel('Котормо тили')).toHaveValue('kk');

    // Studying it: the word that's also in the course keeps its Kyrgyz meaning, and tapping is off.
    await page.getByRole('button', { name: /Окуу · 2/ }).click();
    await page.getByRole('button', { name: 'Жоопту көрсөтүү' }).click();
    await expect(page.locator('[data-translation]')).toContainText('(демо)');
    await expect(page.getByText('Котормосун көрүү үчүн каалаган сөздү басыңыз')).toHaveCount(0);
    await clean('lesson');
  });
});

test('the translation language is changed in settings, and the course goes and comes back with it', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Английский по уровням')).toBeVisible();
  await page.getByRole('button', { name: 'Настройки' }).first().click();
  await page.getByRole('button', { name: /Язык перевода/ }).click();
  await page.getByRole('radio', { name: 'O‘zbekcha' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  // The app's own language stays: the two are separate.
  await expect(page.getByText('Английский по уровням')).toHaveCount(0);
  await page.getByRole('button', { name: 'Настройки' }).first().click();
  await page.getByRole('button', { name: /Язык перевода/ }).click();
  await page.getByRole('radio', { name: 'Русский' }).click();
  await expect(page.getByText('Английский по уровням')).toBeVisible();
});

test('bad wording can be reported from settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Настройки' }).first().click();
  await page.getByRole('button', { name: 'Ошибка в переводе?' }).click();
  await page.getByLabel('Что написано неверно и как правильно?').fill('На кнопке опечатка');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByText('Спасибо! Мы исправим.')).toBeVisible();
});

for (const language of ['ru', 'uz', 'kk', 'ky', 'tg', 'en']) {
  test(`${language}: nothing runs off a small phone's screen`, async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await context.request.patch('/api/me', { data: { ui_language: language } });
    const deck = await (await context.request.post('/api/decks', { data: { title: 'Travel' } })).json();
    await context.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword: 'luggage', translation: 'багаж', pos: 'noun', example: 'My luggage is heavy.' },
    });
    const group = await (
      await (await named(context, 'Anna')).request.post('/api/groups', { data: { name: '7B' } })
    ).json();

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
