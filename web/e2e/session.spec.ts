import { button, expect, finishSession, openDeck, study, test } from './learner.ts';

test('a new learner studies five flashcards and the progress survives a reload', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Открыть курс').click();
  await expect(page.getByRole('button', { name: /^Основа/ })).toContainText('0 из 100');
  await openDeck(page);
  // Each new card says its word by itself, from the recorded file.
  const spoken = page.waitForRequest(/\/audio\/words\/house\.mp3$/);
  await button(page, 'Начать урок · 5 слов').click();
  await spoken;

  // The front shows only the word and its audio; the answer appears on request, with the ratings.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await expect(page.getByText('дом')).toHaveCount(0);
  await button(page, 'Показать ответ').click();
  await expect(page.getByText('дом', { exact: true })).toBeVisible();
  await expect(page.getByText('They live in a small house near the river.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Снова\s*1 мин/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Хорошо\s*10 мин/ })).toBeVisible();
  await page.getByRole('button', { name: /^Хорошо/ }).click();

  await finishSession(page, { water: 'Легко' });
  await expect(page.getByRole('heading', { name: 'Отличная память!' })).toBeVisible();
  await expect(page.getByText(/^Новых — 5\sслов/)).toBeVisible();
  await button(page, 'На главную').click();

  // Back on the deck's page; after a reload, home and the page still know.
  await page.reload();
  await button(page, 'Открыть курс').click();
  await expect(page.getByRole('button', { name: /^Основа/ })).toContainText('5 из 100');
  await openDeck(page);
  await expect(page.getByText('учу 5 · впереди 95', { exact: true })).toBeVisible();
  await expect(button(page, 'Ещё 5 слов')).toBeVisible(); // the daily target is met: a bonus lesson
});

test('a card rated «Снова» comes back later in the same session', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await study(page, 'Снова'); // house
  await study(page, 'Легко'); // water
  await study(page, 'Легко'); // friend
  await study(page, 'Легко'); // buy
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await expect(page.getByText('дом', { exact: true })).toHaveCount(0); // the front again
});

test('every word of the example opens its meaning, and a tap elsewhere closes it', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await button(page, 'Показать ответ').click();

  await page.getByRole('button', { name: 'river', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'river: перевод' });
  await expect(popover).toContainText('река');
  const heard = page.waitForRequest(/\/audio\/glossary\/river\.mp3$/);
  await popover.getByRole('button', { name: 'Послушать: river' }).click();
  await heard;

  await page.getByRole('button', { name: 'live', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'live: перевод' })).toContainText('жить');
  await page.locator('[data-card]').click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the keyboard works like Anki: Space shows the answer, number keys rate', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await page.keyboard.press('Space');
  await expect(page.getByText('дом', { exact: true })).toBeVisible();
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('water');
});

test('an unfinished session resumes where the learner left off', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await study(page, 'Легко');
  await study(page, 'Легко');
  await page.reload();
  await openDeck(page);
  await button(page, 'Продолжить урок').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('friend');
});

test('hard words are summarised and can be practised straight away', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page, { house: 'Снова' });
  await expect(page.getByRole('heading', { name: 'Готово!' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Трудные сейчас/ })).toBeVisible();
  await button(page, 'Повторить трудные').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
});

test('a lesson goes on without a connection, and its answers reach the server once it is back', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  // The connection goes: nothing between cards needs the server (ADR 0062).
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await button(page, 'Показать ответ').click();
  await page.getByRole('button', { name: /^Легко/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('water');
  await expect(page.getByText('Нет связи с сервером')).toHaveCount(0);

  await page.unroute('**/api/**');
  const pushed = page.waitForRequest((request) => request.url().endsWith('/api/sync/push'));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const ops = (await pushed).postDataJSON().ops as { kind: string; exercise_id: string; response: unknown }[];
  expect(ops.filter((op) => op.kind === 'study.answer')).toEqual([
    expect.objectContaining({ exercise_id: 'c1', response: { kind: 'rating', rating: 4 } }),
  ]);
});
