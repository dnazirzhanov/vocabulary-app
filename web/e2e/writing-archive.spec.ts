import { expect, test } from './learner.ts';

/**
 * The essay archive: Writing's home lists no essays, only a way to all of them. The archive reads
 * like the home: topics, then the questions answered in a topic, then one question's attempts,
 * newest first; an attempt opens its feedback, and Back climbs one level at a time.
 * The server's answers are mocked (the endpoint is tested in the backend).
 */
test.use({ writer: true, viewport: { width: 390, height: 844 } });

const id = (n: number) => `bbbbbbbb-bbbb-bbbb-bbbb-${String(n).padStart(12, '0')}`;
const HEALTH = 'Some people think health problems come from lifestyle. Discuss both views.';
const PHONE = 'How often do you use your phone, and what for?';

const essay = (n: number, fields: Record<string, unknown>) => ({
  id: id(n),
  status: 'done',
  overall: null,
  cefr_level: null,
  band: null,
  word_count: 200 + n,
  excerpt: `Opening of essay ${n}…`,
  created_at: `2026-11-${10 + n}T10:00:00Z`,
  ...fields,
});

// Newest first, as the server sends them: three attempts at one Health question, one at another
// Health question, and an old general answer in Everyday Life (a retired question).
const ESSAYS = [
  essay(5, { question_id: 'ielts-health-1', question_title: HEALTH, question_topic: 'Health', band: 6 }),
  essay(4, {
    question_id: 'ielts-health-2',
    question_title: 'Prevention or cure?',
    question_topic: 'Health',
    band: 5.5,
  }),
  essay(3, { question_id: 'ielts-health-1', question_title: HEALTH, question_topic: 'Health', band: 5 }),
  essay(2, { question_id: 'ielts-health-1', question_title: HEALTH, question_topic: 'Health', status: 'failed' }),
  essay(1, {
    question_id: 'life-phone',
    question_title: PHONE,
    question_topic: 'Everyday Life',
    overall: 3,
    cefr_level: 'B1',
  }),
];

test('the archive goes topics → questions → attempts, and each attempt opens', async ({ page }) => {
  await page.route(
    (url) => url.pathname.endsWith('/api/writing/submissions'),
    (route) => route.fulfill({ json: ESSAYS }),
  );
  await page.route(`**/api/writing/submissions/${id(3)}`, (route) =>
    route.fulfill({
      json: {
        id: id(3),
        question_id: 'ielts-health-1',
        question: null,
        answer: 'Opening of essay 3. I think lifestyle matters most.',
        time_spent_seconds: null,
        status: 'done',
        failure_code: null,
        created_at: '2026-11-13T10:00:00Z',
        evaluation: {
          rubric: 'ielts',
          enough_evidence: true,
          criteria: Object.fromEntries(
            ['task_response', 'coherence_cohesion', 'lexical_resource', 'grammatical_range_accuracy'].map((k) => [
              k,
              { band: 5, why: `why ${k}`, next_band: `next ${k}` },
            ]),
          ),
          summary: 'A summary the screen no longer shows.',
          corrections: [],
          upgrades: [],
          band: 5,
          words: 9,
        },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Письмо', exact: true }).click();

  // The home: topics and a way into the archive; no essays, no intro line.
  await expect(page.getByRole('heading', { name: 'Письмо' })).toBeVisible();
  await expect(page.getByText(HEALTH)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Мои ответы' })).toHaveCount(0);
  await expect(page.getByText(/250 слов за 40 минут/)).toHaveCount(0);

  // Topics, in the home's order, each with its count and best band.
  await page.getByRole('button', { name: /Все эссе · 5/ }).click();
  await expect(page.getByRole('heading', { name: 'Все мои эссе' })).toBeVisible();
  const topics = page.getByRole('list', { name: 'Все мои эссе' }).getByRole('listitem');
  await expect(topics).toHaveCount(2);
  await expect(topics.nth(0)).toContainText('Everyday Life');
  await expect(topics.nth(1)).toContainText('Health');
  await expect(topics.nth(1)).toContainText('Эссе: 4');
  await expect(topics.nth(1)).toContainText('IELTS 6');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A topic: the questions answered in it, each with its attempts and best band.
  await topics.nth(1).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
  const questions = page.getByRole('list', { name: 'Health' }).getByRole('listitem');
  await expect(questions).toHaveCount(2);
  await expect(questions.nth(0)).toContainText(HEALTH);
  await expect(questions.nth(0)).toContainText('Попыток: 3');
  await expect(questions.nth(0)).toContainText('IELTS 6');

  // A question: its history of attempts, newest first.
  await questions.nth(0).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'История попыток' })).toBeVisible();
  const attempts = page.getByRole('heading', { name: 'История попыток' }).locator('..').getByRole('listitem');
  await expect(attempts).toHaveCount(3);
  await expect(attempts.nth(0)).toContainText('Opening of essay 5');
  await expect(attempts.nth(0)).toContainText('IELTS 6');
  await expect(attempts.nth(1)).toContainText('IELTS 5');
  await expect(attempts.nth(2)).toContainText('Не проверено');

  // An attempt opens its feedback, without the summary under the band; Back returns to the history.
  await attempts.nth(1).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Общий балл IELTS' })).toBeVisible();
  await expect(page.getByText('A summary the screen no longer shows.')).toHaveCount(0);
  await page.getByRole('button', { name: /Назад/ }).first().click();
  await expect(page.getByRole('heading', { name: 'История попыток' })).toBeVisible();

  // Back climbs: history → the topic → all topics → home.
  await page.getByRole('button', { name: /Назад/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
  await page.getByRole('button', { name: /Назад/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Все мои эссе' })).toBeVisible();
  await page.getByRole('button', { name: /Назад/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Письмо' })).toBeVisible();
});
