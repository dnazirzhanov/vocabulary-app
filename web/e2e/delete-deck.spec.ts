import { button, expect, test } from './learner.ts';

// Deleting a deck (ADR 0019) always asks first, in a window: cancelling keeps it, confirming
// removes it and returns home.
test('deleting a deck asks first; cancel keeps it, confirm removes it', async ({ page, context }) => {
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Путешествия' } })).json();
  await context.request.post(`/api/decks/${deck.id}/words`, {
    data: { headword: 'luggage', pos: 'noun', translation: 'багаж', example: 'My luggage is heavy.' },
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Изменить «Путешествия»' }).click();
  await button(page, 'Удалить колоду').click();
  const confirm = page.getByRole('dialog', { name: 'Удалить колоду «Путешествия»?' });
  await expect(confirm).toContainText('1 слово и прогресс по нему удалятся навсегда');
  // Focus starts on «Отмена»: a reflexive Enter never deletes.
  await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Новые карточки' })).toBeVisible(); // still here

  await button(page, 'Удалить колоду').click();
  await confirm.getByRole('button', { name: 'Удалить колоду' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Путешествия/ })).toHaveCount(0);
  await expect(page.getByText('Своих колод пока нет')).toBeVisible();
});

// From the end of the deck's own page too (ADR 0093), with the same question; and «Планы» lets
// go of it: a deleted deck leaves «Учёба на сегодня», it isn't shown as done.
test("deleted from its page, after it was on today's study list: «Планы» drops it", async ({ page, context }) => {
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Путешествия' } })).json();
  for (const [headword, translation] of [
    ['luggage', 'багаж'],
    ['ticket', 'билет'],
  ]) {
    await context.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, pos: 'noun', translation, example: `My ${headword} is here.` },
    });
  }

  // On today's list first, so «Планы» remembers it.
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  const studyList = page.getByRole('region', { name: 'Учёба на сегодня' });
  await expect(studyList).toContainText('Путешествия');

  // Its page, to the end: «Удалить колоду», asked first.
  await page.getByRole('navigation').getByRole('button', { name: 'Сегодня' }).click();
  await page
    .getByRole('button', { name: /^Путешествия/ })
    .first()
    .click();
  const remove = button(page, 'Удалить колоду');
  await remove.scrollIntoViewIfNeeded();
  await remove.click();
  const confirm = page.getByRole('dialog', { name: 'Удалить колоду «Путешествия»?' });
  await expect(confirm).toContainText('2 слова и прогресс по ним удалятся навсегда');
  await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Путешествия' })).toBeVisible(); // still here

  await remove.click();
  await confirm.getByRole('button', { name: 'Удалить колоду' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Путешествия/ })).toHaveCount(0);

  // «Планы»: gone from today's study, not ticked as done; after a reload too.
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  await expect(page.getByRole('tab', { name: 'Сегодня' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Путешествия')).toHaveCount(0);
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  await expect(page.getByRole('tab', { name: 'Сегодня' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Путешествия')).toHaveCount(0);
});

// Another learner's deck, or a group's: nothing to delete on its page.
test('a deck that is not mine has no delete on its page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Английский по уровням' }).click();
  await page
    .getByRole('button', { name: /^A1–A2|^A1-A2|Основа/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(button(page, 'Удалить колоду')).toHaveCount(0);
});
