import { button, expect, test } from './learner.ts';

/**
 * A lesson left open whose words have since left the deck (ADR 0094): it once shut every deck page
 * and lesson behind «Что-то пошло не так». Now it is set aside: pages open and lessons start. And
 * an error nothing caught is reported to the server, so the next such problem can be found.
 */
test.use({ viewport: { width: 390, height: 844 } });

test('words removed under an open lesson: deck pages still open, and a lesson starts', async ({ page, context }) => {
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Поездка' } })).json();
  const added: string[] = [];
  for (const [headword, translation] of [
    // Not course words: a course word stays in the pack whatever this deck holds.
    ['zeppelin', 'дирижабль'],
    ['quokka', 'квокка'],
    ['origami', 'оригами'],
  ]) {
    const made = await (
      await context.request.post(`/api/decks/${deck.id}/words`, {
        data: { headword, pos: 'noun', translation, example: `The ${headword} is here.` },
      })
    ).json();
    added.push(made.words.at(-1).word.id);
  }
  const reports: { place: string; name: string; message: string }[] = [];
  await page.route('**/api/client-errors', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });

  // A lesson started and left open on this device.
  await page.goto('/');
  await page.getByRole('button', { name: /^Поездка/ }).click();
  await button(page, 'Начать урок · 3 слова').click();
  await page.getByRole('button', { name: 'Выйти из урока' }).click();
  await expect(button(page, 'Продолжить урок')).toBeVisible();

  // Its words leave the deck on the server; the device's next pack no longer has them.
  for (const wordId of added) await context.request.delete(`/api/decks/${deck.id}/words/${wordId}`);
  await page.reload();

  // Another deck's page opens.
  await page.getByRole('button', { name: 'Английский по уровням' }).click();
  await page
    .getByRole('button', { name: /^Основа/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Основа' })).toBeVisible();
  await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
  // And a lesson starts.
  await button(page, 'Начать урок · 5 слов').click();
  await expect(page.getByRole('button', { name: 'Выйти из урока' })).toBeVisible();
  expect(reports).toEqual([]);
});

test("an error nothing caught is reported; the browser's own noise is not", async ({ page }) => {
  const reports: { place: string; name: string; message: string; build: string }[] = [];
  await page.route('**/api/client-errors', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }));
    setTimeout(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'translation')");
    });
  });
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ place: 'uncaught', name: 'TypeError' });
  expect(reports[0].message).toContain('translation');
});
