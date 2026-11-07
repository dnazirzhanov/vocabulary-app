import type { Page } from '@playwright/test';
import { button, expect, fakePush, openDeck, openSettings, test } from './learner.ts';

test.describe('a learner who has not chosen a pace', () => {
  test.use({ onboarded: false });

  test('answers two small questions, one at a time, and starts', async ({ page, learner }) => {
    // A server with no keys for notifications: that question has no answer here, so it isn't asked.
    await page.route('**/api/push/key', (route) => route.fulfill({ json: { public_key: null } }));
    await learner.travelTo(new Date('2026-11-02T09:00:00Z')); // a Monday
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Сколько новых слов в день?' })).toBeFocused();
    // Only the question and its answers: no pitch, no picture, no sums.
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(4);
    await expect(page.getByRole('main').getByRole('img')).toHaveCount(0);
    await expect(page.getByText(/мин|NGSL|Разогрев/)).toHaveCount(0);
    await expect(page.getByRole('main').locator('p')).toHaveCount(0);

    // Tapping an answer is enough; going back shows it still chosen.
    await page.getByRole('button', { name: /^10\sслов$/ }).click();
    await expect(page.getByRole('heading', { name: 'В какие дни будете заниматься?' })).toBeFocused();
    await button(page, 'Назад').click();
    await expect(page.getByRole('button', { name: /^10\sслов$/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^10\sслов$/ }).click();

    // Пн–Сб until chosen, and a preset narrows them (ADR 0039).
    await expect(button(page, 'Сб')).toHaveAttribute('aria-pressed', 'true');
    await button(page, 'Пн–Пт').click();
    await expect(button(page, 'Сб')).toHaveAttribute('aria-pressed', 'false');
    await button(page, 'Начать').click();

    // A development build has no sign-in to leave.
    await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
    await expect(button(page, 'Выйти')).toHaveCount(0);

    // The warm-up stays on by default, and the deck's page says what it does.
    await openDeck(page);
    await expect(page.getByText(/^В день: 10\u00a0новых слов · пока 5, разогрев/)).toBeVisible();
    await expect(button(page, 'Начать урок · 5 слов')).toBeVisible();
    // The promise reads on «Прогресс»; nothing is finished yet, so it applies from today.
    await button(page, 'Прогресс').click();
    await expect(page.getByText(/Обещание: Пн–Пт/)).toBeVisible();
  });

  const toTheQuestion = async (page: Page) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^5\sслов$/ }).click();
    await button(page, 'Дальше').click();
    await expect(page.getByRole('heading', { name: 'Присылать напоминания?' })).toBeFocused();
  };
  const arrived = (page: Page) => expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  const timesAsked = (page: Page) => page.evaluate(() => (window as unknown as { asked?: number }).asked);

  test('yes asks the browser straight away, and tells the server', async ({ page }) => {
    await fakePush(page);
    const told: string[] = [];
    await page.route('**/api/push/subscriptions', (route) => {
      told.push(route.request().postDataJSON().endpoint);
      return route.fulfill({ status: 204 });
    });
    await toTheQuestion(page);
    await button(page, 'Да').click();
    await arrived(page);
    expect(await timesAsked(page)).toBe(1);
    expect(told).toEqual(['https://push.example.com/send/e2e']);
  });

  test('saying no to the browser still goes on, and is not asked again', async ({ page }) => {
    await fakePush(page, 'denied');
    await toTheQuestion(page);
    await button(page, 'Да').click();
    await arrived(page);
    expect(await timesAsked(page)).toBe(1);
  });

  test('not now asks nothing', async ({ page }) => {
    await fakePush(page);
    await toTheQuestion(page);
    await button(page, 'Не сейчас').click();
    await arrived(page);
    expect(await timesAsked(page)).toBeUndefined();
  });

  test('when subscribing fails the app still opens', async ({ page }) => {
    await fakePush(page);
    await page.route('**/api/push/subscriptions', (route) => route.fulfill({ status: 500, json: {} }));
    await toTheQuestion(page);
    await button(page, 'Да').click();
    await arrived(page);
  });

  test('already blocked in the browser: one line on where to allow it, then on', async ({ page }) => {
    await fakePush(page);
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true });
    });
    await toTheQuestion(page);
    await button(page, 'Да').click();
    await expect(page.getByText('Уведомления запрещены в настройках браузера')).toBeVisible();
    await button(page, 'Понятно').click();
    await arrived(page);
  });

  test.describe('on an iPhone, in Safari', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' });

    test('one line on adding it to the home screen, then on', async ({ page }) => {
      await page.route('**/api/push/key', (route) => route.fulfill({ json: { public_key: 'a-key' } }));
      await page.addInitScript(() => {
        delete (window as unknown as { PushManager?: unknown }).PushManager;
      });
      await toTheQuestion(page);
      await button(page, 'Да').click();
      await expect(page.getByText(/На экран „Домой“/)).toBeVisible();
      await button(page, 'Понятно').click();
      await arrived(page);
    });
  });
});

test.describe('a new learner (ADR 0057)', () => {
  test.use({ onboarded: false, named: null });

  test('says their name after the language, then the pace', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Как вас зовут?' })).toBeFocused();
    const field = page.getByLabel('Имя', { exact: true });
    const next = button(page, 'Дальше');
    await expect(next).toBeDisabled();
    // Nothing that reaches a child outside the app: an address is refused before it is sent.
    await field.fill('anna@mail.ru');
    await expect(page.getByText('Только буквы, цифры, пробел и дефис.')).toBeVisible();
    await expect(next).toBeDisabled();
    await field.fill('Анна К.');
    await next.click();
    await expect(page.getByRole('heading', { name: 'Сколько новых слов в день?' })).toBeFocused();
    expect((await (await page.request.get('/api/me')).json()).name).toBe('Анна К.');
  });
});

test.describe('a learner from before names were asked (ADR 0057)', () => {
  test.use({ named: null });

  test('is asked only the name, once, and can change it in settings', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Как вас зовут?' })).toBeFocused();
    await page.getByLabel('Имя', { exact: true }).fill('Анна');
    await button(page, 'Дальше').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

    // The name a group shows is the one from settings, changed in place.
    expect((await page.request.post('/api/groups', { data: { name: '7Б' } })).ok()).toBe(true);
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Настройки' });
    await settings.getByRole('button', { name: /^Имя\s*Анна/ }).click();
    await settings.getByLabel('Имя', { exact: true }).fill('Анна Б.');
    await settings.getByRole('button', { name: 'Сохранить' }).click();
    await expect(settings.getByRole('button', { name: /^Имя\s*Анна Б\./ })).toBeVisible();
    await page.keyboard.press('Escape');
    await button(page, 'Друзья').click();
    await page
      .getByRole('link', { name: /7Б/ })
      .or(page.getByRole('button', { name: /7Б/ }))
      .first()
      .click();
    await expect(page.getByRole('main')).toContainText('Анна Б.');
  });
});
