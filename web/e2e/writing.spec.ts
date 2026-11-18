import { expect, test } from './learner.ts';

/** What the server sends back after a check: the evaluation is the model's, mocked here. */
const done = (answer: string) => ({
  id: '11111111-1111-1111-1111-111111111111',
  question_id: 'life-morning',
  question: {
    id: 'life-morning',
    topic: 'Everyday Life',
    title: 'Describe a typical day in your life.',
    instruction: 'Write about what you usually do from morning to evening.',
    level: 'A2',
    suggested_minutes: 10,
  },
  answer,
  time_spent_seconds: null,
  status: 'done',
  failure_code: null,
  created_at: '2026-11-18T10:00:00Z',
  evaluation: {
    enough_evidence: true,
    cefr_level: 'A2',
    overall: 3,
    criteria: Object.fromEntries(
      ['task', 'organization', 'vocabulary', 'grammar', 'mechanics'].map((k) => [k, { score: 3, comment: `${k} ok` }]),
    ),
    summary: 'A clear short answer.',
    strengths: [{ point: 'Clear routine', quote: 'I go to university by bus' }],
    improvements: ['Check negatives'],
    corrections: [
      { original: 'I no have car', corrected: "I don't have a car", explanation: 'Use don’t.', type: 'grammar' },
    ],
    vocabulary: [{ original: 'good', suggestion: 'excellent', note: 'Stronger.' }],
  },
});

const ANSWER = 'I no have car. I go to university by bus.';

test.use({ viewport: { width: 390, height: 844 } });

async function openQuestion(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Письмо', exact: true }).click();
  await page.getByRole('button', { name: /Everyday Life/ }).click();
  await page.getByRole('button', { name: /Describe a typical day/ }).click();
}

test('topics, questions, then a written answer comes back as feedback', async ({ page }) => {
  let body: Record<string, unknown> = {};
  await page.route('**/api/writing/submissions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: done(ANSWER) });
  });
  await openQuestion(page);
  await page.getByRole('textbox').fill(ANSWER);
  await page.getByRole('button', { name: 'Отправить' }).click();

  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeVisible();
  await expect(page.getByText('Достаточный', { exact: true }).first()).toBeVisible();
  await expect(page.getByText("I don't have a car", { exact: true })).toBeVisible();
  // Feedback comes in sections, the grammar fix sits under Grammar, and no rewritten answer is offered.
  await expect(page.getByRole('heading', { name: 'Грамматика' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Лексика' })).toBeVisible();
  await expect(page.getByText('Улучшенный вариант')).toHaveCount(0);
  // Never used the timer: no time is sent.
  expect(body.time_spent_seconds).toBeNull();
  expect(body.answer).toBe(ANSWER);
  // Nothing sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the timer is optional and its time goes with the answer', async ({ page }) => {
  let body: Record<string, unknown> = {};
  await page.route('**/api/writing/submissions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: done(ANSWER) });
  });
  await openQuestion(page);
  await page.getByRole('textbox').fill(ANSWER);
  await page.getByRole('button', { name: 'Включить таймер' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Остановить/ }).click();
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeVisible();
  expect(body.time_spent_seconds).toBeGreaterThanOrEqual(1);
});

for (const width of [360, 1280]) {
  test(`the word count and a running timer sit between the text and Send, never on them (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 600 ? 740 : 860 });
    await openQuestion(page);
    await page.getByRole('textbox').fill(ANSWER);
    await page.getByRole('button', { name: 'Включить таймер' }).click();
    const timer = page.getByRole('button', { name: /Остановить/ });
    await expect(timer).toContainText('0:0');

    const box = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!;
    const text = await box(page.getByRole('textbox'));
    const clock = await box(timer);
    const count = await box(page.getByText(/^Слов: \d+$/));
    const send = await box(page.getByRole('button', { name: 'Отправить' }));
    // Each sits fully below the text and fully above Send.
    for (const b of [clock, count]) {
      expect(b.y).toBeGreaterThanOrEqual(text.y + text.height);
      expect(b.y + b.height).toBeLessThanOrEqual(send.y);
    }
    // «Слов: 40» stays on one line, beside the timer, not squeezed under it.
    expect(count.height).toBeLessThan(28);
    expect(count.x + count.width).toBeLessThanOrEqual(clock.x);
  });
}

test('an empty answer cannot be sent', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/writing/submissions', async (route) => {
    if (route.request().method() === 'POST') calls += 1;
    await route.continue();
  });
  await openQuestion(page);
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  await page.getByRole('textbox').fill('   ');
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  expect(calls).toBe(0);
});

test('a failed check keeps the text, and trying again sends the same attempt', async ({ page }) => {
  const ids: string[] = [];
  await page.route('**/api/writing/submissions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push((route.request().postDataJSON() as { client_id: string }).client_id);
    if (ids.length === 1) {
      await route.fulfill({ status: 502, json: { error: { code: 'writing_failed', message: 'down' } } });
    } else {
      await route.fulfill({ json: done(ANSWER) });
    }
  });
  await openQuestion(page);
  await page.getByRole('textbox').fill(ANSWER);
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByRole('alert')).toContainText('Ваш текст сохранён');
  await expect(page.getByRole('textbox')).toHaveValue(ANSWER);
  await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test('a slow check shows a loading state and a second tap sends nothing more', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/writing/submissions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    calls += 1;
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({ json: done(ANSWER) });
  });
  await openQuestion(page);
  await page.getByRole('textbox').fill(ANSWER);
  const send = page.getByRole('button', { name: 'Отправить' });
  await send.dblclick();
  await expect(page.getByRole('status')).toContainText('Проверяем');
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeVisible();
  expect(calls).toBe(1);
});

test('too little to assess is said plainly, with no score', async ({ page }) => {
  await page.route('**/api/writing/submissions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const base = done('Bad.');
    await route.fulfill({
      json: {
        ...base,
        evaluation: {
          ...base.evaluation,
          enough_evidence: false,
          criteria: null,
          overall: null,
          cefr_level: null,
          summary: 'Please write more.',
          strengths: [],
          corrections: [],
          vocabulary: [],
        },
      },
    });
  });
  await openQuestion(page);
  await page.getByRole('textbox').fill('Bad.');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByRole('heading', { name: 'Пока мало для оценки' })).toBeVisible();
  await expect(page.getByText('Please write more.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ошибки и исправления' })).toHaveCount(0);
});
