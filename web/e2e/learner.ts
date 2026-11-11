import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

interface Learner {
  /** Moves the server clock (development only) so "come back tomorrow" needs no waiting. */
  travelTo: (moment: Date) => Promise<void>;
}

const learnerId = new WeakMap<BrowserContext, string>();
/** Drafting decks uses the demo, never a real model, even when the dev server holds a key. */
export const DEMO = { 'X-Dev-Generation': 'demo' };

/** Who this learner is, for the same person on a second device. */
export const learnerHeaders = (context: BrowserContext) => ({ 'X-Dev-User': learnerId.get(context)!, ...DEMO });

/** Every test is a brand-new learner, so tests never share progress and can run in parallel. */
export const test = base.extend<{
  learner: Learner;
  onboarded: boolean;
  languageChosen: boolean;
  named: string | null;
  reader: boolean;
}>({
  // `test.use({ onboarded: false })` starts as a learner who has not chosen a pace yet.
  onboarded: [true, { option: true }],
  // `test.use({ languageChosen: false })` starts at the first question of all (ADR 0055).
  languageChosen: [true, { option: true }],
  // The learner's name (ADR 0057); `test.use({ named: null })` starts as one not asked it yet.
  named: ['Тест', { option: true }],
  // `test.use({ reader: true })`: one of Reading Mode's testers (the e2e API lists e2e-reader-*).
  reader: [false, { option: true }],
  context: async ({ context, onboarded, languageChosen, named, reader }, use) => {
    const id = `e2e-${reader ? 'reader-' : ''}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    learnerId.set(context, id);
    await context.setExtraHTTPHeaders({ 'X-Dev-User': id, ...DEMO });
    // Past the first-run screens with the default pace (5 words a day); e2e/goal.spec.ts covers them.
    if (languageChosen) await setUp(context.request, { language: 'ru' });
    if (named) await setUp(context.request, { name: named });
    if (onboarded) await setUp(context.request, { daily_target_words: 5, study_days_per_week: 6 });
    await use(context);
  },
  learner: async ({ context }, use) => {
    await use({
      travelTo: (moment) =>
        context.setExtraHTTPHeaders({
          'X-Dev-User': learnerId.get(context)!,
          'X-Dev-Now': moment.toISOString(),
          ...DEMO,
        }),
    });
  },
});
export { expect };

/** Gives the learner of `context` a name, which joining or starting a group needs (ADR 0057). */
export async function named(context: BrowserContext, name: string) {
  await setUp(context.request, { name });
  return context;
}

/**
 * A learner's settings saved before a test, as the app saves them: a server busy with other tests
 * refuses at once (ADR 0044) and is asked again, as `lib/api.ts` does; any other answer fails here,
 * not later as a puzzling screen.
 */
export async function setUp(request: APIRequestContext, data: Record<string, unknown>) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await request.patch('/api/me', { data });
    if (response.status() !== 503 || attempt >= 5) {
      expect(response.ok(), await response.text()).toBe(true);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
  }
}

export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** ⚙ on any page: sounds, notifications and the account live in a window there (ADR 0042). */
export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Настройки' }).click();
  await expect(page.getByRole('dialog', { name: 'Настройки' })).toBeVisible();
}

/** Opens a course level's page (ADR 0020): from home, through «Открыть курс» (ADR 0021). Lessons
 * are started there, one deck at a time. */
export async function openDeck(page: Page, title = 'Основа') {
  const course = page.getByRole('button', { name: 'Английский по уровням' });
  const row = page.getByRole('button', { name: new RegExp(`^${title}`) });
  // Home (with the course button) or the course already: whichever has loaded.
  await expect(course.or(row).first()).toBeVisible();
  if (await course.isVisible()) await course.click();
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

export type RatingLabel = 'Снова' | 'Трудно' | 'Хорошо' | 'Легко';

/** Words seen in this test, by their Russian meaning: a spelling recall shows only the meaning. */
const wordsByMeaning = new WeakMap<Page, Map<string, string>>();
const meanings = (page: Page) => {
  if (!wordsByMeaning.has(page)) wordsByMeaning.set(page, new Map());
  return wordsByMeaning.get(page)!;
};

/** Studies the card on screen: shows the answer, rates it, and waits for the next card. */
export async function study(page: Page, rating: RatingLabel = 'Хорошо') {
  const card = page.locator('[data-card]');
  const id = await card.getAttribute('data-card');
  await button(page, 'Показать ответ').click();
  const headword = (await card.getByRole('heading', { level: 1 }).textContent())!;
  meanings(page).set((await card.locator('[data-translation]').textContent())!.trim(), headword);
  await page.getByRole('button', { name: new RegExp(`^${rating}`) }).click();
  // The next card replaces this one, or the summary appears.
  await expect(page.locator(`[data-card="${id}"]`)).toHaveCount(0);
}

/**
 * Builds the word of the spelling card on screen (typed: letters pick tiles), checks it and moves
 * on. The card shows only the meaning; the word is known from the flashcards earlier in the test.
 * `answer` builds something else instead (a mistake).
 */
export async function spell(page: Page, answer?: string) {
  const exercise = page.locator('[data-spelling]');
  const id = await exercise.getAttribute('data-spelling');
  const meaning = (await exercise.locator('[data-translation]').textContent())!.trim();
  const word = meanings(page).get(meaning);
  if (!word) throw new Error(`no word known for «${meaning}»`);
  await page.keyboard.type(answer ?? word);
  await button(page, 'Проверить').click();
  await button(page, 'Дальше').click();
  await expect(page.locator(`[data-spelling="${id}"]`)).toHaveCount(0);
}

/** Today's spelling (ADR 0016), from the button on home or on a lesson's summary, to its end. */
export async function spellToday(page: Page, misspell: Record<string, string> = {}) {
  await page
    .getByRole('button', { name: /^Правописание · / })
    .first()
    .click();
  await finishSession(page, {}, misspell);
}

/**
 * Finishes the session: each card's first showing rated as given (by headword, default
 * «Хорошо»); each spelling card built right — or, for a word in `misspell`, built that way.
 */
export async function finishSession(
  page: Page,
  ratings: Record<string, RatingLabel> = {},
  misspell: Record<string, string> = {},
) {
  const seen = new Set<string>();
  // The lesson first: the screen it was started from may have its own «На главную».
  await expect(page.getByRole('button', { name: 'Выйти из урока' })).toBeVisible();
  const summary = page.getByRole('button', { name: 'На главную' });
  const card = page.locator('[data-card]');
  const spelling = page.locator('[data-spelling]');
  while (!(await summary.isVisible())) {
    // The next card's front, a spelling exercise, or the summary. The last answered exercise
    // lingers for a moment while the lesson is completed, so wait for something to answer.
    await expect(button(page, 'Показать ответ').or(button(page, 'Проверить')).or(summary).first()).toBeVisible();
    if (await summary.isVisible()) break;
    if (await spelling.count()) {
      const meaning = (await spelling.locator('[data-translation]').textContent())!.trim();
      const word = meanings(page).get(meaning);
      await spell(page, word ? misspell[word] : undefined);
      continue;
    }
    const headword = (await card.getByRole('heading', { level: 1 }).textContent())!;
    await study(page, seen.has(headword) ? 'Хорошо' : (ratings[headword] ?? 'Хорошо'));
    seen.add(headword);
  }
}

export const PUSH_KEY = 'BKt2ZcGWyL1nHxVrBWc05nQd1LgcNTZ8aEZNAWJ3aKAlXU_nO7YWV2HNQo9IRbbmLg4R0KF95W6nLsQqEGa2RWE';

/**
 * Real delivery needs a push service and the server's keys. Here the browser's push is a stand-in
 * and the server's key is given. `answer`: what the learner tells the browser's popup.
 */
export async function fakePush(page: Page, answer: NotificationPermission = 'granted') {
  await page.addInitScript((given) => {
    let current: { endpoint: string; toJSON: () => object; unsubscribe: () => Promise<boolean> } | null = null;
    const subscription = () => ({
      endpoint: 'https://push.example.com/send/e2e',
      toJSON: () => ({ endpoint: 'https://push.example.com/send/e2e', keys: { p256dh: 'BKey', auth: 'auth' } }),
      unsubscribe: async () => ((current = null), true),
    });
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => permission, configurable: true });
    Notification.requestPermission = async () => {
      (window as unknown as { asked: number }).asked = ((window as unknown as { asked?: number }).asked ?? 0) + 1;
      permission = given;
      return given;
    };
    PushManager.prototype.subscribe = async function () {
      current = subscription();
      return current as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async function () {
      return current as unknown as PushSubscription;
    };
  }, answer);
  await page.route('**/api/push/key', (route) => route.fulfill({ json: { public_key: PUSH_KEY } }));
}
