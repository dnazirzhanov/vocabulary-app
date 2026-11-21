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

test.use({ writer: true, viewport: { width: 390, height: 844 } });

async function openQuestion(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Письмо', exact: true }).click();
  await page.getByRole('button', { name: /Everyday Life/ }).click();
  // IELTS Task 2 questions since ADR 0081: the first of Everyday Life.
  await page.getByRole('button', { name: /cooking at home/ }).click();
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

  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeAttached();
  await expect(page.getByText('Достаточный', { exact: true }).first()).toBeVisible();
  // No overall summary and no rewritten answer: only the specific fixes.
  await expect(page.getByText('A clear short answer.')).toHaveCount(0);
  await expect(page.getByText('Улучшенный вариант')).toHaveCount(0);

  // The answer comes back with its first fix marked and numbered, and its category open beside it.
  const grammar = page.getByRole('tab', { name: 'Грамматика' });
  await expect(grammar).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^I no have car\s*1$/ })).toBeVisible();
  const panel = page.getByRole('tabpanel');
  // The fix shows in its sentence, changed in place, with the reason; the general comment gives way to it.
  await expect(panel.locator('del')).toHaveText('I no have car');
  await expect(panel.locator('ins')).toHaveText("I don't have a car");
  await expect(panel).toContainText('Use don’t.');
  await expect(panel).not.toContainText('grammar ok');

  // A category with no fixes shows its comment instead.
  await page.getByRole('tab', { name: 'Задание' }).click();
  await expect(panel).toContainText('task ok');
  // The original answer is one tap away, with nothing marked.
  await page.getByRole('button', { name: 'Оригинал' }).click();
  await expect(page.getByRole('button', { name: /^I no have car/ })).toHaveCount(0);
  await expect(page.getByText(ANSWER, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'С исправлениями' }).click();
  // Tapping a mark opens its category again.
  await page.getByRole('button', { name: /^I no have car\s*1$/ }).click();
  await expect(grammar).toHaveAttribute('aria-selected', 'true');
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
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeAttached();
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
    const count = await box(page.getByText(/^\d+ из 250 слов$/));
    const send = await box(page.getByRole('button', { name: 'Отправить' }));
    // Each sits fully below the text and fully above Send.
    for (const b of [clock, count]) {
      expect(b.y).toBeGreaterThanOrEqual(text.y + text.height);
      expect(b.y + b.height).toBeLessThanOrEqual(send.y);
    }
    // «10 из 250 слов» stays on one line, beside the timer, not squeezed under it.
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
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeAttached();
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
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeAttached();
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
  await expect(page.getByRole('tab')).toHaveCount(0);
  // Leaving from the feedback: a back button, as on every other Writing screen.
  await page.getByRole('button', { name: /Назад/ }).click();
  await expect(page.getByRole('button', { name: /cooking at home/ })).toBeVisible();
});

// IELTS Task 2 (ADR 0081/0082): the band first, the four criteria as chips, each criterion with
// why and the step to the next band; the fixes marked in the essay; no list of generic advice.
const IELTS_ANSWER = 'In my opinion, I am agree that cooking at home is important. It save money.';
const ielts = {
  id: '44444444-4444-4444-4444-444444444444',
  question_id: 'ielts-life-1',
  question: {
    id: 'ielts-life-1',
    topic: 'Everyday Life',
    title: 'Some people believe that cooking at home is a waste of time. To what extent do you agree or disagree?',
    instruction: 'Give reasons for your answer. Write at least 250 words.',
    level: null,
    suggested_minutes: 40,
    task_type: 'opinion',
  },
  answer: IELTS_ANSWER,
  time_spent_seconds: null,
  status: 'done',
  failure_code: null,
  created_at: '2026-11-21T10:00:00Z',
  evaluation: {
    rubric: 'ielts',
    enough_evidence: true,
    band: 5.5,
    words: 15,
    criteria: {
      task_response: { band: 6, why: 'A clear position.', next_band: 'Support it with an example.' },
      coherence_cohesion: { band: 6, why: 'One paragraph only.', next_band: 'Use paragraphs.' },
      lexical_resource: { band: 6, why: 'Simple but correct.', next_band: 'Use topic words.' },
      grammatical_range_accuracy: { band: 4, why: '«I am agree», «It save».', next_band: 'Check verb forms.' },
    },
    summary: 'A clear view, held back by verb errors.',
    corrections: [
      { original: 'I am agree', corrected: 'I agree', explanation: 'agree is a verb.', type: 'grammar' },
      { original: 'It save', corrected: 'It saves', explanation: 'he/she/it + s.', type: 'grammar' },
    ],
    upgrades: [],
  },
};

test('IELTS feedback: the band, four criteria, why and the next step; no generic advice', async ({ page }) => {
  await page.route('**/api/writing/submissions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ json: ielts });
  });
  await openQuestion(page);
  // The question's type and the IELTS length as a guide, counted toward 250.
  await expect(page.getByText('Мнение', { exact: true })).toBeVisible();
  await page.getByRole('textbox').fill(IELTS_ANSWER);
  await expect(page.getByText('15 из 250 слов')).toBeVisible();
  await page.getByRole('button', { name: 'Отправить' }).click();

  await expect(page.getByRole('heading', { name: 'Общий балл IELTS' })).toBeVisible();
  await expect(page.getByText('5.5', { exact: true })).toBeVisible();
  const chips = page.getByRole('list', { name: 'Баллы по критериям' });
  await expect(chips.getByRole('button')).toHaveText(['TR6', 'CC6', 'LR6', 'GRA4']);
  await expect(page.getByText('на экзамене нужно от 250 слов', { exact: false })).toBeVisible();
  // It opens on the lowest criterion, with why, the next band's step, and its fixes.
  const panel = page.getByRole('tabpanel');
  await expect(page.getByRole('tab', { name: 'GRA' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toContainText('Грамматика: разнообразие и точность');
  await expect(panel).toContainText('Чтобы получить 5: Check verb forms.');
  await expect(panel.locator('ins')).toHaveText(['I agree', 'It saves']);
  // A chip opens its criterion.
  await chips.getByRole('button', { name: /^Связность/ }).click();
  await expect(panel).toContainText('Use paragraphs.');
  // «Что делать дальше» is gone.
  await expect(page.getByText('Что делать дальше')).toHaveCount(0);
});
