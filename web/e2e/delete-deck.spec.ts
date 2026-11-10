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
