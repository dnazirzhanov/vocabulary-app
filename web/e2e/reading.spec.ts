import { type Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

// Reading Mode, phase 2 (docs/product/reading-mode-spec.md): a tab for testers, a library by topic
// and level, and a reader that keeps its look and where I stopped, on this device.

const tab = (page: Page) => page.getByRole('navigation').getByRole('button', { name: 'Чтение' });

test.describe('a tester', () => {
  test.use({ reader: true });

  test('finds an article by level, reads it in their own look, and finishes it', async ({ page }) => {
    await page.goto('/');
    await tab(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Чтение' })).toBeVisible();
    // Topics as sections; the level filter narrows them.
    await expect(page.getByRole('region', { name: 'Культура' })).toContainText('Tea');
    await page.getByRole('button', { name: 'B2', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Культура' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Природа' })).toContainText('Volcanoes');
    await page.getByRole('button', { name: 'Все', exact: true }).click();

    // The reader: the article, its level and length, its source; no tab bar.
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
    await expect(page.getByText('B1 · Культура · 2 мин')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText(/Источник: Simple English Wikipedia/)).toBeVisible();

    // «Aa»: the night page and a bigger text, kept for next time.
    await page.getByRole('button', { name: 'Вид текста' }).click();
    const sheet = page.getByRole('dialog', { name: 'Вид текста' });
    await sheet.getByRole('radio', { name: 'Ночь' }).click();
    await sheet.getByRole('button', { name: 'Больше' }).click();
    await page.keyboard.press('Escape');
    const reader = page.locator('[data-theme]');
    await expect(reader).toHaveAttribute('data-theme', 'night');
    await expect(page.locator('article p[data-i]').first()).toHaveCSS('font-size', '20px');

    // «Готово» at the end: back in the library, the article marked read.
    await button(page, 'Готово').click();
    await expect(page.getByRole('button', { name: /^Tea/ })).toContainText('Прочитано');
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'night');
  });

  test('home loads nothing of Reading Mode; the reader loads its font only when opened', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requests.filter((url) => /\/reading\/|literata|ReadingScreens/i.test(url))).toEqual([]);
    await tab(page).click();
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
    await expect.poll(() => requests.some((url) => /literata/i.test(url))).toBe(true);
    // Reading makes no API request: the article is a file.
    const api = requests.length;
    await page.locator('article').evaluate((node) => node.closest('[data-theme]')!.scrollTo(0, 400));
    expect(requests.slice(api).filter((url) => url.includes('/api/'))).toEqual([]);
  });

  test('a missing article says so and offers to try again', async ({ page }) => {
    await page.route('**/reading/tea.json', (route) => route.fulfill({ status: 404, body: 'gone' }));
    await page.goto('/');
    await tab(page).click();
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(page.getByRole('alert')).toContainText('Не удалось открыть статью.');
    await page.unroute('**/reading/tea.json');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
  });
});

test('a learner who is not a tester has no «Чтение» tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await expect(tab(page)).toHaveCount(0);
});
