import { expect, test } from './learner.ts';

/**
 * What the mentor remembers (ADR 0075): a fact offered in the chat is kept only on the tap, then
 * shows on «Что наставник знает обо мне», where the learner changes or forgets it.
 */
test.use({ mentor: true, viewport: { width: 390, height: 844 } });

test('a fact said in the chat is kept on the tap, and can be changed and forgotten', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await page.getByRole('button', { name: 'Спросить наставника…' }).click();
  const composer = page.getByRole('textbox', { name: 'Напишите вопрос…' });
  await composer.fill('Я люблю футбол и сериалы');
  await composer.press('Enter');
  await expect(page.getByText('Хочу запомнить')).toBeVisible();
  // Nothing kept before the tap.
  expect((await (await page.request.get('/api/mentor/memory')).json()).facts).toEqual([]);
  await page.getByRole('button', { name: 'Запомнить', exact: true }).click();
  await expect(page.getByText('Запомнил')).toBeVisible();

  await page.getByRole('button', { name: 'Чаты', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Чаты' })
    .getByRole('button', { name: 'Что наставник знает обо мне' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Что наставник знает обо мне' })).toBeVisible();
  const likes = page.getByRole('region', { name: 'Что нравится' });
  await expect(likes).toContainText('Я люблю футбол и сериалы');

  await likes.getByRole('button', { name: /^Изменить:/ }).click();
  await page.getByRole('textbox', { name: /Например/ }).fill('Любит футбол');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(likes).toContainText('Любит футбол');
  await likes.getByRole('button', { name: /^Забыть:/ }).click();
  await expect(page.getByText('Пока ничего.', { exact: false })).toBeVisible();
});

test('the learner adds a fact themselves, and the plan’s story shows', async ({ page }) => {
  await page.request.put('/api/mentor/coach/commitment', {
    data: { weekdays: [0, 1, 2, 3, 4], start_minute: 19 * 60, minutes: 20 },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await page.getByRole('button', { name: 'Что наставник знает обо мне' }).click();
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByRole('combobox', { name: 'О чём это' }).selectOption({ label: 'Когда есть силы' });
  await page.getByRole('textbox', { name: /Например/ }).fill('Лучше занимаюсь утром');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('region', { name: 'Когда есть силы' })).toContainText('Лучше занимаюсь утром');
  await expect(page.getByRole('region', { name: 'Что было с планом' })).toContainText('Время занятий: 19:00, 20 мин');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
