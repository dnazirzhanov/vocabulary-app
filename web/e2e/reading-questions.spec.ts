import { type Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

// Comprehension questions (round 2, C): after the text, each answered in writing or by voice within
// its word limits (never over 500 words), the answer kept to read or change whenever one likes.

test.use({ reader: true });

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${String.fromCharCode(97 + (i % 26))}`).join(' ');

async function openTea(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
}

/** "Why is black tea also called red tea": 10–60 words. */
const whyRed = (page: Page) => page.getByRole('textbox', { name: /Why is black tea also called/ });

test('an answer within its limits is sent, kept and changed', async ({ page }) => {
  await openTea(page);
  const questions = page.getByRole('region', { name: 'Вопросы к тексту' });
  await questions.scrollIntoViewIfNeeded();
  await expect(questions.getByRole('listitem')).toHaveCount(3);

  // Too short: counted, and nothing to send yet.
  await whyRed(page).fill('Because it looks red.');
  await expect(questions.getByText('4 / 10–60 слов')).toBeVisible();
  const send = questions.getByRole('listitem').nth(1).getByRole('button', { name: 'Отправить' });
  await expect(send).toBeDisabled();
  const answer = 'When black tea leaves are brewed in boiling water, the tea looks deep dark red.';
  await whyRed(page).fill(answer);
  await expect(questions.getByText('15 / 10–60 слов')).toBeVisible();
  await send.click();
  await expect(questions.getByRole('listitem').nth(1)).toContainText(answer);
  await expect(whyRed(page)).toHaveCount(0);

  // Still there after a reload; the library counts it.
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await expect(page.getByRole('button', { name: /^Tea/ })).toContainText('Ответы · 1/3');
  await page.getByRole('button', { name: /^Tea/ }).click();
  const second = page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(1);
  await expect(second).toContainText(answer);

  // Changed: the box comes back with it.
  await second.getByRole('button', { name: 'Изменить' }).click();
  await expect(whyRed(page)).toHaveValue(answer);
  await whyRed(page).fill(`${answer} In China it is called red tea.`);
  await second.getByRole('button', { name: 'Отправить' }).click();
  await expect(second).toContainText('In China it is called red tea.');
});

test('over the limit cannot be sent, and the box never holds more than 500 words', async ({ page }) => {
  await openTea(page);
  await whyRed(page).fill(words(61));
  const second = page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(1);
  await expect(second.getByText('61 / 10–60 слов')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  await whyRed(page).fill(words(520));
  await expect(second.getByText('500 / 10–60 слов')).toBeVisible();
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
  const said = 'black tea leaves look red when they are brewed in boiling water';
  await fakeSpeech(page, said);
  await openTea(page);
  const second = page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(1);
  await whyRed(page).fill('In my opinion');
  await second.getByRole('button', { name: 'Сказать' }).click();
  // What was typed stays; speech follows it.
  await expect(whyRed(page)).toHaveValue(`In my opinion ${said}`);
  await expect(second.getByText('15 / 10–60 слов')).toBeVisible();
  await second.getByRole('button', { name: 'Отправить' }).click();
  await expect(second).toContainText(said);
});

test('a microphone not allowed says so; typing still works', async ({ page }) => {
  await fakeSpeech(page, null);
  await openTea(page);
  const second = page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(1);
  await second.getByRole('button', { name: 'Сказать' }).click();
  await expect(second.getByRole('alert')).toHaveText(
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

test('a text of my own gets questions with its meanings', async ({ page }) => {
  await page.request.post('/api/readings', {
    data: { title: 'The oven', text: 'My grandmother showed me how to bake bread in an old oven.' },
  });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Мои тексты/ }).click();
  await page.getByRole('button', { name: /^The oven/ }).click();
  const questions = page.getByRole('region', { name: 'Вопросы к тексту' });
  await expect(questions.getByRole('listitem')).toHaveCount(3);
  await questions.getByRole('textbox').first().fill('It is about baking bread with a grandmother.');
  await questions.getByRole('listitem').first().getByRole('button', { name: 'Отправить' }).click();
  await expect(questions.getByRole('listitem').first()).toContainText('It is about baking bread');
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
    const answer = 'When black tea leaves are brewed in boiling water, the tea looks deep dark red.';
    // The questions show at once, before the server answers.
    await whyRed(page).fill(answer);
    const second = page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(1);
    await second.getByRole('button', { name: 'Отправить' }).click();
    await expect(second).toContainText(answer);
    release();
    await page.waitForTimeout(500);
    await expect(second).toContainText(answer);
    // Kept on the device too: after a reload, with the server still not having it.
    await page.reload();
    await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
    await page.getByRole('button', { name: /^Культура/ }).click();
    await page.getByRole('button', { name: /^Tea/ }).click();
    await expect(page.getByRole('region', { name: 'Вопросы к тексту' }).getByRole('listitem').nth(1)).toContainText(
      answer,
    );
  });
});
