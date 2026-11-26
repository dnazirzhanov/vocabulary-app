import type { Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

/**
 * Pausing a spoken answer and going on with it (the owner, 22 November 2026): the audio so far is
 * kept, the clock stands still while paused, and it all becomes one answer. The browser's fake
 * microphone stands in for the learner's voice.
 */
test.use({
  speaker: true,
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

async function openExercise(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Речь' }).click();
  await page.getByRole('button', { name: /^Говорение/ }).click();
  await page.getByRole('button', { name: /^Daily Life/ }).click();
  await page.getByRole('button', { name: /typical morning routine/ }).click();
  await button(page, '🎙 Новая попытка').click();
  await expect(page.getByRole('heading', { name: 'Говорение' })).toBeVisible();
}

const timer = (page: Page) => page.getByText(/^\d+:\d\d$/);

test('an answer can be paused and resumed, and the paused time is not counted', async ({ page }) => {
  await openExercise(page);
  const enable = page.getByRole('button', { name: 'Разрешить микрофон' });
  if (await enable.isVisible()) await enable.click();
  await button(page, 'Начать запись').click();
  await expect(page.getByText('Идёт запись', { exact: true })).toBeVisible();
  await expect(timer(page)).toHaveText('0:01', { timeout: 5_000 });

  // Paused: the clock stands still, and it says how to go on.
  await button(page, 'Пауза').click();
  await expect(page.getByText('На паузе', { exact: true })).toBeVisible();
  await expect(page.getByText(/Запись на паузе/)).toBeVisible();
  const held = await timer(page).textContent();
  await page.waitForTimeout(2_500);
  await expect(timer(page)).toHaveText(held!);
  await expect(page.getByRole('button', { name: 'Пауза' })).toHaveCount(0);

  // On again into the same answer, then stopped: one recording, to hear and send.
  await button(page, 'Продолжить').click();
  await expect(page.getByText('Идёт запись', { exact: true })).toBeVisible();
  await expect(timer(page)).not.toHaveText(held!, { timeout: 5_000 });
  await button(page, 'Остановить').click();
  await expect(button(page, 'Послушать')).toBeVisible();
  await expect(button(page, 'Отправить')).toBeVisible();
  // Under 2.5 s of pause added: the length is the recorded time, not the time on the clock.
  const [m, s] = (await timer(page).textContent())!.split(':').map(Number);
  expect(m * 60 + s).toBeLessThan(5);
});

test('Speaking opens on three cards; «Говорение» holds the topics, and back returns there', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Речь' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Речь' })).toBeVisible();
  const cards = page.getByRole('main').getByRole('listitem');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Шэдоуинг');
  await expect(cards.nth(1)).toContainText('Говорение');
  await expect(cards.nth(1)).toContainText(/тем: \d+/);
  await expect(cards.nth(2)).toContainText('Мои ответы');
  // No topics on the home itself.
  await expect(page.getByRole('button', { name: /^Daily Life/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: /^Говорение/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Темы для говорения' })).toBeVisible();
  await page.getByRole('button', { name: /^Daily Life/ }).click();
  // Back from a topic: its list of topics, then the three cards.
  await page.getByRole('button', { name: 'Назад' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Темы для говорения' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Речь' })).toBeVisible();
});

test('a word of a speaking question can be tapped for its meaning', async ({ page }) => {
  await openExercise(page);
  await page.getByRole('button', { name: 'morning', exact: true }).first().click();
  const card = page.getByRole('dialog', { name: 'morning: перевод' });
  await expect(card).toContainText('перевод «morning» (демо)');
});
