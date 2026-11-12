import { type Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

// Questions after the text (round 2): three with options on its facts, answered once and marked at
// once; two open ones answered in writing or by voice within their word limits (never over 500),
// the unsent words kept as a draft, the answer kept to read or change whenever one likes.

test.use({ reader: true });

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${String.fromCharCode(97 + (i % 26))}`).join(' ');

async function openTea(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
}

/** Tea's fourth question, open: why people drink tea everywhere, 30–150 words. */
const whyDrunk = (page: Page) => page.getByRole('textbox', { name: /Why do you think people in so many/ });
const item = (page: Page, n: number) =>
  page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(n);
const ANSWER =
  'People drink tea in many countries because it is cheap, warm and calming, and because sharing tea with guests is an old custom in many families and cultures around the world.';

test('an open answer within its limits is sent, kept and changed', async ({ page }) => {
  await openTea(page);
  const questions = page.getByRole('region', { name: 'Вопросы к тексту' });
  await questions.scrollIntoViewIfNeeded();
  await expect(questions.getByRole('listitem')).toHaveCount(5);

  // Too short: counted, and nothing to send yet.
  await whyDrunk(page).fill('Because it tastes good.');
  await expect(item(page, 3).getByText('4 / 30–150 слов')).toBeVisible();
  const send = item(page, 3).getByRole('button', { name: 'Отправить' });
  await expect(send).toBeDisabled();
  await whyDrunk(page).fill(ANSWER);
  await expect(item(page, 3).getByText('31 / 30–150 слов')).toBeVisible();
  await send.click();
  await expect(item(page, 3)).toContainText(ANSWER);
  await expect(whyDrunk(page)).toHaveCount(0);

  // Still there after a reload; the library counts it.
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await expect(page.getByRole('button', { name: /^Tea/ })).toContainText('Ответы · 1/5');
  await page.getByRole('button', { name: /^Tea/ }).click();
  await expect(item(page, 3)).toContainText(ANSWER);

  // Changed: the box comes back with it.
  await item(page, 3).getByRole('button', { name: 'Изменить' }).click();
  await expect(whyDrunk(page)).toHaveValue(ANSWER);
  await whyDrunk(page).fill(`${ANSWER} Tea is also part of many celebrations.`);
  await item(page, 3).getByRole('button', { name: 'Отправить' }).click();
  await expect(item(page, 3)).toContainText('Tea is also part of many celebrations.');
});

test('a question with options is checked at once, and stays as answered', async ({ page }) => {
  await openTea(page);
  // "Why is black tea called red tea in China?": the right one is the last option.
  const question = item(page, 2);
  const check = question.getByRole('button', { name: 'Проверить' });
  await expect(check).toBeDisabled();
  await question.getByRole('radio', { name: 'It grows only in red soil' }).click();
  await check.click();
  await expect(question.getByRole('status')).toHaveText(
    'Неверно. Правильный ответ: Brewed in boiling water, it looks deep dark red',
  );
  await expect(question.getByRole('radio', { name: 'It grows only in red soil' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(question.getByRole('radio')).toHaveCount(4);
  for (const option of await question.getByRole('radio').all()) await expect(option).toBeDisabled();

  // Another, right.
  await item(page, 0).getByRole('radio', { name: 'The leaves of the Camellia sinensis plant' }).click();
  await item(page, 0).getByRole('button', { name: 'Проверить' }).click();
  await expect(item(page, 0).getByRole('status')).toHaveText('Верно');

  // As answered after a reload: one try.
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await expect(page.getByRole('button', { name: /^Tea/ })).toContainText('Ответы · 2/5');
  await page.getByRole('button', { name: /^Tea/ }).click();
  await expect(item(page, 2).getByRole('status')).toContainText('Неверно');
  await expect(item(page, 2).getByRole('button', { name: 'Проверить' })).toHaveCount(0);
});

test('words written and not sent wait as a draft when one goes elsewhere', async ({ page }) => {
  await openTea(page);
  await whyDrunk(page).fill('Tea is popular because');
  // Away to «Сегодня» and back.
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Сегодня' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await expect(whyDrunk(page)).toHaveValue('Tea is popular because');
  // Sent, the draft is gone: «Изменить» starts from the answer.
  await whyDrunk(page).fill(ANSWER + ' Truly.');
  await item(page, 3).getByRole('button', { name: 'Отправить' }).click();
  await expect(item(page, 3).getByRole('button', { name: 'Изменить' })).toBeVisible();
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await expect(item(page, 3)).toContainText(ANSWER);
  await expect(whyDrunk(page)).toHaveCount(0);
});

test('over the limit cannot be sent, and the box never holds more than 500 words', async ({ page }) => {
  await openTea(page);
  await whyDrunk(page).fill(words(151));
  await expect(item(page, 3).getByText('151 / 30–150 слов')).toBeVisible();
  await expect(item(page, 3).getByRole('button', { name: 'Отправить' })).toBeDisabled();
  await whyDrunk(page).fill(words(520));
  await expect(item(page, 3).getByText('500 / 30–150 слов')).toBeVisible();
});

/** The browser's speech recognition, played back: what a learner says, then silence. */
async function fakeSpeech(page: Page, heard: string | null) {
  await page.addInitScript((said) => {
    class Recognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          if (said === null) this.onerror?.({ error: 'not-allowed' });
          else {
            const half = said.split(' ').slice(0, 3).join(' ');
            this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: half } }] });
            this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: said } }] });
          }
          this.onend?.();
        }, 50);
      }
      stop() {
        this.onend?.();
      }
    }
    const browser = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown };
    browser.SpeechRecognition = Recognition;
    browser.webkitSpeechRecognition = Recognition;
  }, heard);
}

test('an answer can be spoken: what is heard goes into the box, to be corrected and sent', async ({ page }) => {
  const said =
    'people drink tea everywhere because it is cheap and warm and it brings families and friends together after work and at every celebration';
  await fakeSpeech(page, said);
  await openTea(page);
  await whyDrunk(page).fill('In my opinion');
  await item(page, 3).getByRole('button', { name: 'Сказать' }).click();
  // What was typed stays; speech follows it.
  await expect(whyDrunk(page)).toHaveValue(`In my opinion ${said}`);
  await expect(item(page, 3).getByText('26 / 30–150 слов')).toBeVisible();
  await whyDrunk(page).fill(`In my opinion ${said} and on holidays with the whole family.`);
  await item(page, 3).getByRole('button', { name: 'Отправить' }).click();
  await expect(item(page, 3)).toContainText(said);
});

test('a microphone not allowed says so; typing still works', async ({ page }) => {
  await fakeSpeech(page, null);
  await openTea(page);
  await item(page, 3).getByRole('button', { name: 'Сказать' }).click();
  await expect(item(page, 3).getByRole('alert')).toHaveText(
    'Нет доступа к микрофону. Разрешите его в настройках или напишите ответ.',
  );
});

test('where the browser has no speech recognition, no «Сказать» is offered', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });
  await openTea(page);
  await expect(page.getByRole('button', { name: 'Сказать' })).toHaveCount(0);
});

test('a text of my own gets three questions with options and two open ones', async ({ page }) => {
  await page.request.post('/api/readings', {
    data: { title: 'The oven', text: 'My grandmother showed me how to bake bread in an old oven.' },
  });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Мои тексты/ }).click();
  await page.getByRole('button', { name: /^The oven/ }).click();
  const questions = page.getByRole('region', { name: 'Вопросы к тексту' });
  // Three with options, then two open ones.
  await expect(questions.getByRole('listitem')).toHaveCount(5);
  await expect(item(page, 0).getByRole('radio')).toHaveCount(4);
  await expect(item(page, 3).getByRole('textbox')).toBeVisible();
  await item(page, 3).getByRole('textbox').fill('It is about baking bread with a grandmother.');
  await item(page, 3).getByRole('button', { name: 'Отправить' }).click();
  await expect(item(page, 3)).toContainText('It is about baking bread');
  await expect(button(page, 'Изменить')).toBeVisible();
});

// Answers to a request made before the service worker could see it: the worker is blocked, so the
// held reply below is really held (in CI's production build it would fetch past the route).
test.describe('with no service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('answers loading late never undo one just written', async ({ page }) => {
    // Not sent yet (as offline), and the server's list, asked when the article opened, comes back
    // only after the answer is written, without it.
    await page.route('**/api/sync/push', (route) => route.abort('internetdisconnected'));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    await page.route('**/api/reading-answers?*', async (route) => {
      if (first) {
        first = false;
        await held;
      }
      await route.fulfill({ json: [] });
    });
    await openTea(page);
    const answer = `${ANSWER} Truly.`;
    // The questions show at once, before the server answers.
    await whyDrunk(page).fill(answer);
    await item(page, 3).getByRole('button', { name: 'Отправить' }).click();
    await expect(item(page, 3)).toContainText(answer);
    release();
    await page.waitForTimeout(500);
    await expect(item(page, 3)).toContainText(answer);
    // Kept on the device too: after a reload, with the server still not having it.
    await page.reload();
    await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
    await page.getByRole('button', { name: /^Культура/ }).click();
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(item(page, 3)).toContainText(answer);
  });
});
