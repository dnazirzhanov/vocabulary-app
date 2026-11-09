import type { Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

// A deck drafted from photos of a page (ADR 0029): read in the browser — here a stand-in for
// the OCR engine, so the test needs no download — up to 4 at a time and 8 per deck.

const PAGES: Record<string, string> = {
  'page-1.jpg': 'Scientists measured the pollution in the river every morning.',
  'page-2.jpg': 'After several setbacks, the company managed to carry out the experi-\nment.',
};
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from('jpeg') });
const photos = (count: number) => Array.from({ length: count }, (_, index) => photo(`extra-${index}.jpg`));

async function draft(page: Page, count: number) {
  await button(page, `Подобрать ${count}\u00a0слов`).click();
  await expect(page.getByRole('status').filter({ hasText: /Добавлено|добавлен/ })).toBeVisible();
}

test('a teacher drafts words from photos: four at a time, eight per deck, up to 50 words', async ({
  page,
  context,
}) => {
  await page.addInitScript((pages) => {
    window.__ocrForTests = (name: string) =>
      pages[name] ?? `Travellers usually exchange currency before departure from ${name}.`;
  }, PAGES);
  await context.request.post('/api/decks', { data: { title: 'Unit 6' } });
  await page.goto('/');
  // An empty deck opens in its editor.
  await page.getByRole('button', { name: /^Unit 6/ }).click();
  await page.getByRole('tab', { name: 'Текст' }).click();
  await expect(page.getByText('До 4 за раз · для этой колоды осталось 8 из 8')).toBeVisible();

  // Two photos: their text lands in the box, a line split by a hyphen joined again.
  await page.getByLabel('Фото страниц').setInputFiles([photo('page-1.jpg'), photo('page-2.jpg')]);
  const box = page.getByLabel('Текст урока');
  await expect(box).toHaveValue(
    `${PAGES['page-1.jpg']}\n\nAfter several setbacks, the company managed to carry out the experiment.`,
  );
  await expect(page.getByText('Текст с 2 фото — в поле выше.', { exact: false })).toBeVisible();

  // Any number of words up to 50: a quick choice or one's own.
  await page.getByLabel('или своё число, до 50').fill('70');
  await expect(page.getByLabel('или своё число, до 50')).toHaveValue('50');
  await page.getByText('30', { exact: true }).click();
  await draft(page, 30);
  await expect(page.getByText('для этой колоды осталось 6 из 8')).toBeVisible();

  // Five at once: the first four are read.
  await page.getByLabel('Фото страниц').setInputFiles(photos(5));
  await expect(page.getByText('Взяли первые 4 фото: за один раз — не больше 4 фото.')).toBeVisible();
  await draft(page, 30);
  // The deck's count is redrawn a moment after the draft (kept on the device first): wait for it,
  // as a person would see it, before choosing more.
  await expect(page.getByText('для этой колоды осталось 2 из 8')).toBeVisible();

  // Two left for the deck: of three, two are read; then no more photos for it.
  await page.getByLabel('Фото страниц').setInputFiles(photos(3));
  await expect(page.getByText('Взяли первые 2 фото: для этой колоды осталось 2 фото.')).toBeVisible();
  await draft(page, 30);
  await expect(page.getByText('В колоду уже добавлено 8 фото — больше нельзя.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить фото' })).toBeDisabled();
});

test('a screenshot can be dragged onto the panel or pasted into the text box', async ({ page, context }) => {
  await page.addInitScript(() => {
    window.__ocrForTests = (name: string) =>
      name === 'dragged.png'
        ? 'Factories burn fossil fuels and release carbon dioxide.'
        : 'Governments must phase out coal and invest in renewable energy.';
  });
  await context.request.post('/api/decks', { data: { title: 'Unit 7' } });
  await page.goto('/');
  await page.getByRole('button', { name: /^Unit 7/ }).click();
  await page.getByRole('tab', { name: 'Текст' }).click();
  const panel = page.locator('form[aria-labelledby="tab-text"]');
  const files = (name: string, type = 'image/png') =>
    page.evaluateHandle(
      ([fileName, fileType]) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['png'], fileName, { type: fileType }));
        return transfer;
      },
      [name, type],
    );

  // Dragged over: the panel says where to drop; dropped: the text is read in.
  const dragged = await files('dragged.png');
  await panel.dispatchEvent('dragenter', { dataTransfer: dragged });
  await expect(page.getByText('Отпустите — прочитаем текст с картинки')).toBeVisible();
  await panel.dispatchEvent('drop', { dataTransfer: dragged });
  await expect(page.getByText('Отпустите — прочитаем текст с картинки')).toHaveCount(0);
  const box = page.getByLabel('Текст урока');
  await expect(box).toHaveValue('Factories burn fossil fuels and release carbon dioxide.');

  // Not a picture: nothing read, and the panel says why.
  await panel.dispatchEvent('drop', { dataTransfer: await files('notes.pdf', 'application/pdf') });
  await expect(page.getByText('Это не картинка: перетащите скриншот или фото страницы (PNG, JPG).')).toBeVisible();

  // A screenshot in the clipboard, pasted into the box.
  await box.evaluate(
    (element, transfer) => {
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    await files('pasted.png'),
  );
  await expect(box).toHaveValue(
    'Factories burn fossil fuels and release carbon dioxide.\n\nGovernments must phase out coal and invest in renewable energy.',
  );
  await expect(page.getByText('для этой колоды осталось 6 из 8', { exact: false })).toBeVisible();
});
