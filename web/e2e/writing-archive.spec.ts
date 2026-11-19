import { expect, test } from './learner.ts';

/**
 * The essay archive: Writing's home shows the latest three and a way to all of them; the archive
 * lists every essay with its opening, length and mark, and opens a marked one to its feedback.
 * The server's answers are mocked (the endpoint is tested in the backend).
 */
test.use({ writer: true, viewport: { width: 390, height: 844 } });

const id = (n: number) => `bbbbbbbb-bbbb-bbbb-bbbb-${String(n).padStart(12, '0')}`;
// Newest first, as the server sends them.
const ESSAYS = Array.from({ length: 7 }, (_, i) => {
  const n = 7 - i;
  return {
    id: id(n),
    question_id: 'life-morning',
    question_title: `Essay question ${n}`,
    status: n === 1 ? 'failed' : 'done',
    overall: n === 1 ? null : (n % 5) + 1,
    cefr_level: n === 1 ? null : 'B1',
    word_count: 40 + n,
    excerpt: `Opening of essay ${n} about my morning…`,
    created_at: `2026-11-${10 + n}T10:00:00Z`,
  };
});

test('every essay is kept, and each opens to its feedback', async ({ page }) => {
  await page.route(
    (url) => url.pathname.endsWith('/api/writing/submissions'),
    (route) => route.fulfill({ json: ESSAYS }),
  );
  await page.route(`**/api/writing/submissions/${id(6)}`, (route) =>
    route.fulfill({
      json: {
        id: id(6),
        question_id: 'life-morning',
        question: null,
        answer: 'Opening of essay 6 about my morning. I wake up early.',
        time_spent_seconds: null,
        status: 'done',
        failure_code: null,
        created_at: '2026-11-16T10:00:00Z',
        evaluation: {
          enough_evidence: true,
          cefr_level: 'B1',
          overall: 2,
          criteria: Object.fromEntries(
            ['task', 'organization', 'vocabulary', 'grammar', 'mechanics'].map((k) => [k, { score: 2, comment: k }]),
          ),
          summary: 'Short.',
          strengths: [],
          improvements: [],
          corrections: [],
          vocabulary: [],
        },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Письмо', exact: true }).click();
  await expect(page.getByRole('button', { name: /Essay question \d/ })).toHaveCount(3);

  await page.getByRole('button', { name: 'Все эссе · 7' }).click();
  await expect(page.getByRole('heading', { name: 'Все мои эссе' })).toBeVisible();
  const rows = page.getByRole('list', { name: 'Все мои эссе' }).getByRole('listitem');
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toContainText('Opening of essay 7');
  await expect(rows.nth(0)).toContainText('Слов: 47');
  await expect(rows.nth(0)).toContainText('B1');
  await expect(rows.nth(6)).toContainText('Не проверено');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await rows.nth(1).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeAttached();
  await page.getByRole('button', { name: /Назад/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Все мои эссе' })).toBeVisible();
});
