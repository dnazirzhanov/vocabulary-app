import { type Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

// Texts of one's own in Reading Mode (round 2, R2-B): pasted or photographed, filed in categories
// one makes, read like the library's, their words kept and studied the same way.

const TEXT = `Last summer my family visited a small village in the mountains.

My grandmother showed me how to bake bread in an old oven.`;

test.use({ reader: true });

const tab = (page: Page) => page.getByRole('navigation').getByRole('button', { name: 'Чтение' });
const section = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });

test('a text of my own: into a new category, read, a word kept and studied', async ({ page }) => {
  await page.goto('/');
  await tab(page).click();
  await section(page, 'Свой текст').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Свой текст' })).toBeVisible();

  // Nothing to save until there is English text; the count follows it.
  await expect(button(page, 'Готово')).toBeDisabled();
  await page.getByRole('textbox', { name: 'Текст на английском' }).fill(TEXT);
  await expect(page.getByText('23 из 2000 слов')).toBeVisible();
  await button(page, 'Новая').click();
  await page.getByRole('textbox', { name: 'Название категории' }).fill('Каникулы');
  await button(page, 'Создать').click();
  await expect(button(page, 'Каникулы')).toHaveAttribute('aria-pressed', 'true');
  // No title given: its first words are.
  await button(page, 'Готово').click();

  await expect(page.getByRole('heading', { level: 1, name: 'Last summer my family visited a…' })).toBeVisible();
  await expect(page.getByText(/Мой текст/)).toBeVisible();
  await page.locator('article [data-f="grandmother"]').click();
  const sheet = page.getByRole('region', { name: 'grandmother' });
  await expect(sheet).toContainText('перевод «grandmother» (демо)');
  await expect(sheet).toContainText('My grandmother showed me how to bake bread in an old oven.');
  await button(page, 'Добавить в слова').click();
  await expect(button(page, 'Учить · 1')).toBeVisible();

  // In the library, under its category; its deck under «Из чтения» on home.
  await page.getByRole('button', { name: 'Назад' }).click();
  await section(page, 'Каникулы').click();
  await expect(page.getByRole('region', { name: 'Каникулы' })).toContainText('Last summer my family visited a…');
  await page.getByRole('navigation').getByRole('button', { name: 'Сегодня' }).click();
  await page.getByRole('button', { name: /^Из чтения/ }).click();
  await expect(page.getByRole('button', { name: /^Last summer my family/ })).toBeVisible();
});

test('while its meanings are written, a tapped word says so, and gets its meaning when ready', async ({ page }) => {
  const made = await (await page.request.post('/api/readings', { data: { title: 'The village', text: TEXT } })).json();
  // The first answers say the meanings are still being written.
  let asked = 0;
  await page.route(`**/api/readings/${made.id}`, async (route) => {
    asked += 1;
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: asked < 3 ? { ...real, status: 'drafting', glossary: {} } : real });
  });
  await page.goto('/');
  await tab(page).click();
  await section(page, 'Мои тексты').click();
  await page.getByRole('button', { name: /^The village/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Значения слов готовятся…' })).toBeVisible();
  await page.locator('article [data-f="oven"]').click();
  const sheet = page.getByRole('region', { name: 'oven' });
  await expect(sheet).toContainText('Значения слов готовятся…');
  await expect(button(page, 'Добавить в слова')).toHaveCount(0);
  // Asked again a few seconds later: the open sheet shows the meaning.
  await expect(sheet).toContainText('перевод «oven» (демо)', { timeout: 10_000 });
  await expect(button(page, 'Добавить в слова')).toBeVisible();
});

test('a category renamed and deleted keeps its texts; a text deleted is gone', async ({ page }) => {
  const category = await (await page.request.post('/api/reading-categories', { data: { name: 'Уроки' } })).json();
  await page.request.post('/api/readings', { data: { title: 'The village', text: TEXT, category_id: category.id } });
  await page.goto('/');
  await tab(page).click();
  await section(page, 'Уроки').click();
  await button(page, 'Изменить категорию').click();
  const dialog = page.getByRole('dialog', { name: 'Изменить категорию' });
  await dialog.getByRole('textbox', { name: 'Название категории' }).fill('Домашка');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  // Renamed, it stays open.
  await expect(section(page, 'Домашка')).toHaveAttribute('aria-expanded', 'true');
  await button(page, 'Изменить категорию').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить категорию' }).click();
  await expect(section(page, 'Домашка')).toHaveCount(0);
  await section(page, 'Мои тексты').click();
  await page.getByRole('button', { name: /^The village/ }).click();

  await page.getByRole('button', { name: 'Вид текста' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить текст' }).click();
  const confirm = page.getByRole('dialog', { name: 'Удалить текст «The village»?' });
  await confirm.getByRole('button', { name: 'Удалить текст' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Чтение' })).toBeVisible();
  await expect(section(page, 'Мои тексты')).toHaveCount(0);
});

test('a text over 2000 words is not taken', async ({ page }) => {
  await page.goto('/');
  await tab(page).click();
  await section(page, 'Свой текст').click();
  await page.getByRole('textbox', { name: 'Текст на английском' }).fill('word '.repeat(2001));
  await expect(page.getByText('2001 из 2000 слов')).toBeVisible();
  await expect(page.getByText('Текст длиннее 2000 слов. Разделите его на части.')).toBeVisible();
  await expect(button(page, 'Готово')).toBeDisabled();
});

test('the library articles have no «Удалить текст»', async ({ page }) => {
  await page.goto('/');
  await tab(page).click();
  await section(page, 'Культура').click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await page.getByRole('button', { name: 'Вид текста' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Удалить текст' })).toHaveCount(0);
});
