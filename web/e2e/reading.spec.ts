import { type Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

// Reading Mode (docs/product/reading-mode-spec.md): a tab for testers; topics that open to their
// articles; a reader that keeps its look and place; words to tap and keep as cards; highlights.

const tab = (page: Page) => page.getByRole('navigation').getByRole('button', { name: 'Чтение' });
const topic = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });

async function openArticle(page: Page, topicName: string, title: RegExp) {
  await page.goto('/');
  await tab(page).click();
  await topic(page, topicName).click();
  await page.getByRole('button', { name: title }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Selects the text of paragraph `p` from character `from` to `to`, as a finger or mouse would. */
async function select(page: Page, p: number, from: number, to: number) {
  await page.locator(`article [data-i="${p}"]`).evaluate(
    (paragraph, [start, end]) => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent!.length;
        if (seen <= start && start <= seen + length) range.setStart(node, start - seen);
        if (seen <= end && end <= seen + length) {
          range.setEnd(node, end - seen);
          break;
        }
        seen += length;
      }
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    },
    [from, to],
  );
}

test.describe('a tester', () => {
  test.use({ reader: true });

  test('topics open to their articles; the level narrows them', async ({ page }) => {
    await page.goto('/');
    await tab(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Чтение' })).toBeVisible();
    // Topics first, with how many articles; no article titles until one is opened.
    await expect(topic(page, 'Наука')).toContainText('2');
    await expect(page.getByRole('button', { name: /^Tea/ })).toHaveCount(0);
    await topic(page, 'Культура').click();
    await expect(topic(page, 'Культура')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Культура' })).toContainText('Tea');
    // B2: culture has nothing at that level, so its row goes.
    await page.getByRole('button', { name: 'B2', exact: true }).click();
    await expect(topic(page, 'Культура')).toHaveCount(0);
    await topic(page, 'Природа').click();
    await expect(page.getByRole('region', { name: 'Природа' })).toContainText('Volcanoes');
  });

  test('reads in their own look, back where they stopped, and finishes', async ({ page }) => {
    await openArticle(page, 'Культура', /^Tea/);
    await expect(page.getByText('B1 · Культура · 2 мин')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText(/Источник: Simple English Wikipedia/)).toBeVisible();
    await page.getByRole('button', { name: 'Вид текста' }).click();
    const sheet = page.getByRole('dialog', { name: 'Вид текста' });
    await sheet.getByRole('radio', { name: 'Ночь' }).click();
    await sheet.getByRole('button', { name: 'Больше' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'night');
    await expect(page.locator('article p[data-i]').first()).toHaveCSS('font-size', '20px');
    await button(page, 'Готово').click();
    await expect(page.getByRole('button', { name: /^Tea/ })).toContainText('Прочитано');
  });

  test('a tapped word shows its meaning without asking the server; kept words become a lesson', async ({ page }) => {
    await openArticle(page, 'Культура', /^Tea/);
    const api: string[] = [];
    page.on('request', (request) => request.url().includes('/api/') && api.push(request.url()));

    // "leaves": its dictionary form, meaning, explanation and its sentence; no request.
    await page.locator('article [data-f="leaves"]').first().click();
    const sheet = page.getByRole('region', { name: 'leaf' });
    await expect(sheet).toContainText('leaves → leaf');
    await expect(sheet).toContainText('листья');
    await expect(sheet).toContainText('Tea is a caffeinated drink made from steeping the leaves');
    expect(api).toEqual([]);

    // Kept: a card in the article's own deck; the same word again is already there.
    await button(page, 'Добавить в слова').click();
    await expect(sheet).toContainText('В словах статьи');
    await expect(page.getByRole('button', { name: 'Слова из статьи: 1' })).toBeVisible();
    await page.locator('article [data-f="leaves"]').nth(1).click();
    await expect(page.getByRole('region', { name: 'leaf' })).toContainText('В словах статьи');

    // A name is said to be one, and is not offered as a card.
    await page.locator('article [data-f="china"]').first().click();
    await expect(page.getByRole('region', { name: 'china' })).toContainText('имя или название');
    await expect(button(page, 'Добавить в слова')).toHaveCount(0);

    // Another word, then the basket: both, one removed, the other studied as a real lesson.
    await page.locator('article [data-f="herbal"]').first().click();
    await button(page, 'Добавить в слова').click();
    await page.getByRole('button', { name: 'Слова из статьи: 2' }).click();
    const basket = page.getByRole('dialog', { name: 'Слова из статьи' });
    await expect(basket.getByRole('listitem')).toHaveCount(2);
    await basket.getByRole('button', { name: 'Убрать: herbal' }).click();
    await expect(basket.getByRole('listitem')).toHaveCount(1);
    await basket.getByRole('button', { name: 'Учить · 1 слово' }).click();
    await expect(page.locator('[data-card]')).toContainText('leaf');
  });

  test('highlights and notes stay with the article, listed on their own', async ({ page }) => {
    await openArticle(page, 'История', /^Wilbur and Orville/);
    // "inventors who made" in the first paragraph, snapped to whole words.
    await select(page, 0, 45, 59);
    await button(page, 'Выделить').click();
    await expect(page.locator('article mark')).toHaveText('inventors who made');
    await expect(page.getByRole('button', { name: 'Выделения и заметки: 1' })).toBeVisible();

    // Esc closes a word's sheet; a selection made while it is open replaces it.
    await page.locator('article [data-f="flight"]').first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'flight' })).toHaveCount(0);
    await page.locator('article [data-f="flight"]').first().click();
    await expect(page.getByRole('region', { name: 'flight' })).toBeVisible();

    // A second one with a note.
    await select(page, 1, 0, 13);
    await expect(page.getByRole('region', { name: 'flight' })).toHaveCount(0);
    await button(page, 'Заметка').click();
    const editor = page.getByRole('dialog', { name: 'Ваша заметка' });
    await editor.getByRole('textbox', { name: 'Ваша заметка' }).fill('his full name');
    await editor.getByRole('button', { name: 'Сохранить' }).click();

    // Only this article's highlights, in reading order, kept after a reload.
    await page.reload();
    await tab(page).click();
    await topic(page, 'История').click();
    await page.getByRole('button', { name: /^Wilbur and Orville/ }).click();
    await page.getByRole('button', { name: 'Выделения и заметки: 2' }).click();
    const notes = page.getByRole('dialog', { name: 'Выделения и заметки' });
    await expect(notes.getByRole('listitem')).toHaveCount(2);
    await expect(notes.getByRole('listitem').first()).toContainText('inventors who made');
    await expect(notes.getByRole('listitem').nth(1)).toContainText('Wilbur Wright');
    await expect(notes.getByRole('listitem').nth(1)).toContainText('his full name');
    await page.keyboard.press('Escape');

    // Another article has none of them.
    await page.getByRole('button', { name: 'Назад' }).click();
    await topic(page, 'Культура').click();
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(page.getByRole('button', { name: 'Выделения и заметки: 0' })).toBeVisible();
  });

  test('home loads nothing of Reading Mode; the reader loads its font only when opened', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requests.filter((url) => /\/reading\/|literata|ReadingScreens/i.test(url))).toEqual([]);
    await tab(page).click();
    await topic(page, 'Культура').click();
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
    await expect.poll(() => requests.some((url) => /literata/i.test(url))).toBe(true);
  });

  // These answer for the server with made-up files. A production build's service worker would
  // fetch the real ones past them (CI found it); offline-reading.spec.ts covers the worker.
  test.describe('with no service worker', () => {
    test.use({ serviceWorkers: 'block' });

    test('a topic shows five articles, then «Показать ещё»', async ({ page }) => {
      const articles = Array.from({ length: 7 }, (_, n) => ({
        id: `science-${n}`,
        title: `Science article ${n + 1}`,
        subtitle: 'About science.',
        topic: 'science',
        level: 'B1',
        minutes: 2,
      }));
      await page.route('**/reading/index.json', (route) => route.fulfill({ json: { articles } }));
      await page.goto('/');
      await tab(page).click();
      await topic(page, 'Наука').click();
      const science = page.getByRole('region', { name: 'Наука' });
      await expect(science.getByRole('listitem')).toHaveCount(5);
      await button(page, 'Показать ещё · 2').click();
      await expect(science.getByRole('listitem')).toHaveCount(7);
    });

    test('a missing article says so and offers to try again', async ({ page }) => {
      await page.route('**/reading/tea.json', (route) => route.fulfill({ status: 404, body: 'gone' }));
      await page.goto('/');
      await tab(page).click();
      await topic(page, 'Культура').click();
      await page.getByRole('button', { name: /^Tea/ }).click();
      await expect(page.getByRole('alert')).toContainText('Не удалось открыть статью.');
      await page.unroute('**/reading/tea.json');
      await page.getByRole('button', { name: 'Повторить' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
    });
  });
});

test('a learner who is not a tester has no «Чтение» tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await expect(tab(page)).toHaveCount(0);
});
