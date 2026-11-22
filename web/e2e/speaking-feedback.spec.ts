import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';

/**
 * The feedback page for a spoken answer: the overall score alone on its card, then five categories
 * that open to their own facts; nothing repeated below them. The assessment is mocked (its scoring is
 * the backend's, tested there); the questions and navigation are real.
 */
test.use({ speaker: true, viewport: { width: 390, height: 844 } });

const SESSION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const words = 'I think that the best place um is my home city because it is very green'.split(' ');
const transcriptWords = words.map((word, i) => ({
  word,
  start_ms: i * 400 + (i >= 4 ? 900 : 0),
  end_ms: i * 400 + 330 + (i >= 4 ? 900 : 0),
  confidence: 1,
}));

const assessment = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  transcript: words.join(' '),
  transcript_words: transcriptWords,
  pronunciation_score: 82.6,
  fluency_score: 61,
  vocabulary_score: 64.5,
  grammar_score: 80,
  coherence_score: 70,
  overall_score: 71.6,
  pronunciation_words: [{ word: 'green', accuracy_score: 92, error_type: 'None', phonemes: [] }],
  feedback_items: [
    {
      category: 'grammar',
      severity: 'minor',
      original_text: 'it are',
      corrected_text: 'it is',
      explanation: 'Singular subject.',
    },
    {
      category: 'fluency',
      severity: 'info',
      original_text: null,
      corrected_text: null,
      explanation: 'Plan the next phrase before a pause.',
    },
  ],
  evidence: {
    whisper: { duration_s: 119.9 },
    feedback: { summary: 'SUMMARY THAT MUST NOT SHOW' },
    fluency: {
      wpm: 99.5,
      silent_pauses: 2,
      pauses_inside_phrase: 1,
      filled_pauses: 1,
      mean_run_words: 6.5,
      pauses: [
        { start_ms: 1300, ms: 1400, kind: 'silent', inside_phrase: true, before: 'the', after: 'best' },
        { start_ms: 3300, ms: 330, kind: 'filled', inside_phrase: true, before: 'place', after: 'is' },
      ],
    },
    vocabulary: {
      profile: { 'A1-A2': 0.8, B1: 0.15, B2: 0.05, 'C1+': 0 },
      mattr: 0.86,
      repeated: [],
      evidence: {
        misused: [{ quote: 'very green', better: 'leafy', why: 'More precise for a city.' }],
        overused: [],
        strong: [],
      },
    },
    grammar: {},
    coherence: { justification: 'Clear main idea.' },
    azure_pa: { pronunciation_score: 82.6 },
  },
  created_at: '2026-11-19T10:00:00Z',
};

async function openFeedback(page: Page) {
  await page.route('**/api/speaking/sessions?question_id=*', (route) =>
    route.fulfill({
      json: [
        {
          id: SESSION,
          question_id: 'spon-hometown',
          status: 'done',
          started_at: '2026-11-19T10:00:00Z',
          completed_at: '2026-11-19T10:02:00Z',
          overall_score: 71.6,
          pronunciation_score: 82.6,
          fluency_score: 61,
          vocabulary_score: 64.5,
          grammar_score: 80,
          coherence_score: 70,
        },
      ],
    }),
  );
  await page.route(`**/api/speaking/sessions/${SESSION}`, (route) =>
    route.fulfill({
      json: {
        id: SESSION,
        question_id: 'spon-hometown',
        exercise_type: 'spontaneous',
        status: 'done',
        failure_reason: null,
        started_at: '2026-11-19T10:00:00Z',
        completed_at: '2026-11-19T10:02:00Z',
        audio: null,
        assessment,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Речь' }).click();
  await page.getByRole('button', { name: /^Говорение/ }).click();
  await page.getByRole('button', { name: /Daily Life/ }).click();
  await page.getByRole('button', { name: /Describe your home city/ }).click();
  await page.getByRole('button', { name: /#1/ }).click();
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeVisible();
}

test('the overall card shows the score alone, and nothing is repeated below the categories', async ({ page }) => {
  await openFeedback(page);
  await expect(page.getByText('72%', { exact: true })).toBeVisible();
  await expect(page.getByText('2:00', { exact: true })).toBeVisible();
  // No summary under the score, no «Транскрипция» or «Советы» sections after the categories.
  await expect(page.getByText('SUMMARY THAT MUST NOT SHOW')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Транскрипция' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Советы' })).toHaveCount(0);
  // Each item lives in its own category, shown once it is opened.
  await expect(page.getByText('Singular subject.')).toHaveCount(0);
  await page.getByRole('button', { name: /Грамматика/ }).click();
  await expect(page.getByText('Singular subject.')).toHaveCount(1);
});

test('fluency shows the answer with each pause and «эм» where it happened', async ({ page }) => {
  await openFeedback(page);
  await page.getByRole('button', { name: /Беглость/ }).click();
  await expect(page.getByText('100 сл/мин')).toBeVisible(); // 99.5, rounded
  await expect(page.getByText('2 (внутри фразы: 1)')).toBeVisible();
  const spoken = page.getByRole('region', { name: 'Ваш ответ' });
  await expect(spoken.getByLabel('Пауза 1,4 с')).toBeVisible();
  // Whisper wrote this «um»: it shows once, as a marked filler, not twice.
  await expect(spoken.getByText('um', { exact: true })).toHaveCount(1);
  await expect(spoken.getByText('эм', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Plan the next phrase before a pause.')).toBeVisible();
});

test('vocabulary shows its word levels and quoted evidence', async ({ page }) => {
  await openFeedback(page);
  await page.getByRole('button', { name: /Словарный запас/ }).click();
  await expect(page.getByRole('heading', { name: 'Уровень слов' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /^A1-A2\s*80%$/ })).toBeVisible();
  await expect(page.locator('del', { hasText: 'very green' })).toBeVisible();
  await expect(page.locator('ins', { hasText: 'leafy' })).toBeVisible();
  // Nothing sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
