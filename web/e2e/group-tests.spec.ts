import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { button, DEMO, expect, test } from './learner.ts';

// A group's spelling tests (ADR 0046): the owner sets one up and opens it, everyone takes it alone
// in their own order against their own clock, and the results are open to the group by name.

const WORDS: Record<string, string> = {
  неудача: 'setback',
  'выгодная покупка': 'bargain',
  засуха: 'drought',
  урожай: 'harvest',
  фонарь: 'lantern',
  луг: 'meadow',
  сад: 'orchard',
  галька: 'pebble',
  ссора: 'quarrel',
  лента: 'ribbon',
};

async function deckFor(context: BrowserContext, groupId: string, count = 10) {
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Unit 4' } })).json();
  for (const [translation, headword] of Object.entries(WORDS).slice(0, count)) {
    const added = await context.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, translation, pos: 'noun', example: `An example with ${headword}.` },
    });
    expect(added.ok()).toBe(true);
  }
  const given = await context.request.post(`/api/decks/${deck.id}/publish`, { data: { group_id: groupId } });
  expect(given.ok()).toBe(true);
  return deck.id as string;
}

async function ownerGroup(context: BrowserContext, count = 10) {
  const group = await (await context.request.post('/api/groups', { data: { name: '7Б', nickname: 'Ольга' } })).json();
  const deckId = await deckFor(context, group.id, count);
  return { id: group.id as string, code: group.invite_code as string, deckId };
}

const identities = new WeakMap<BrowserContext, string>();

async function member(browser: Browser, code: string, nickname: string) {
  const id = `e2e-m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext({ extraHTTPHeaders: { ...DEMO, 'X-Dev-User': id } });
  identities.set(context, id);
  await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await context.request.post(`/api/groups/join/${code}`, { data: { nickname } });
  return context;
}

async function openTests(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await page.getByRole('button', { name: /^Тесты/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Тесты' })).toBeVisible();
}

async function openDeckTest(page: Page) {
  await openTests(page);
  await page.getByRole('button', { name: /^Unit 4/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Unit 4' })).toBeVisible();
}

/** The one attempt, past the question that guards it. */
async function startTest(page: Page) {
  await button(page, 'Начать тест').click();
  await page.getByRole('dialog', { name: 'Начать тест?' }).getByRole('button', { name: 'Начать', exact: true }).click();
}

const meaning = (page: Page) => page.locator('[data-spelling]').getByRole('heading', { level: 1 });

async function build(page: Page, word: string) {
  for (const letter of word) {
    await page.getByRole('group', { name: 'Буквы' }).getByRole('button', { name: letter, exact: true }).first().click();
  }
}

/** Answers until the result; the words whose meaning is in `wrong` are built from the wrong word. */
async function answerAll(page: Page, wrong: string[] = []) {
  const order: string[] = [];
  for (;;) {
    const done = page.getByRole('button', { name: 'Готово', exact: true });
    await expect(meaning(page).or(done)).toBeVisible();
    if (await done.isVisible()) return order;
    const shown = (await meaning(page).textContent())!;
    order.push(shown);
    const word = WORDS[shown];
    // The same letters in another order: always spells something wrong.
    await build(page, wrong.includes(shown) ? [...word].reverse().join('') : word);
    await button(page, 'Дальше').click();
    await expect(done.or(page.getByText(`${order.length} / `))).toBeVisible();
  }
}

test('the owner sets a test up in one window, and a member cannot', async ({ page, context, browser }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();

  await openDeckTest(page);
  await button(page, 'Настроить тест').click();
  const setup = page.getByRole('dialog', { name: 'Настройка теста' });
  await expect(setup.getByText('Все (10)')).toBeVisible();
  await expect(setup.getByLabel('Время, мин')).toHaveValue('10');
  await expect(setup.getByLabel('Сдать от, %')).toHaveValue('80');
  // The word list stays folded until asked for.
  await expect(setup.getByRole('checkbox')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Убрать слова' }).click();
  await setup.getByRole('checkbox', { name: /setback/ }).uncheck();
  await expect(setup.getByText('Все (9)')).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Убраны: 1' })).toBeVisible();
  await setup.getByLabel('Сдать от, %').fill('101');
  await expect(setup.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await expect(setup.getByText('Сдать от: от 1 до 100%.')).toBeVisible();
  await setup.getByLabel('Сдать от, %').fill('70');
  await setup.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByText('9 слов · 10 мин · сдать от 70%')).toBeVisible();
  // Saved is not yet open.
  await openDeckTest(annaPage);
  await expect(annaPage.getByText('Тест ещё не открыт')).toBeVisible();
  // Nobody is behind on a test that has never been open.
  await expect(annaPage.getByRole('region', { name: 'Ещё не проходили' })).toHaveCount(0);
  await expect(annaPage.getByRole('button', { name: 'Настроить тест' })).toHaveCount(0);
  await expect(annaPage.getByRole('button', { name: 'Открыть тест' })).toHaveCount(0);

  await button(page, 'Открыть тест').click();
  await expect(button(page, 'Закрыть тест')).toBeVisible();
  // Settings wait until it is closed again.
  await expect(page.getByRole('button', { name: 'Настроить тест' })).toHaveCount(0);
  await annaPage.reload();
  await openDeckTest(annaPage);
  await expect(button(annaPage, 'Начать тест')).toBeVisible();
  await anna.close();
});

test('two students get their own order, and the results are open by name', async ({ page, context, browser }) => {
  const group = await ownerGroup(context);
  const setup = await context.request.get(`/api/groups/${group.id}/tests/${group.deckId}/setup`);
  const excluded = (await setup.json()).words.find((word: { headword: string }) => word.headword === 'pebble').id;
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, {
    data: { excluded_word_ids: [excluded] },
  });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const ivan = await member(browser, group.code, 'Иван');
  const dina = await member(browser, group.code, 'Дина');
  const annaPage = await anna.newPage();
  const ivanPage = await ivan.newPage();

  await openDeckTest(annaPage);
  await expect(annaPage.getByText('9 слов · 10 мин · сдать от 80%')).toBeVisible();
  // The one attempt is guarded: «Отмена» has the focus, and cancelling starts nothing.
  await button(annaPage, 'Начать тест').click();
  const question = annaPage.getByRole('dialog', { name: 'Начать тест?' });
  await expect(question.getByText('Время пойдёт сразу. Попытка одна.')).toBeVisible();
  await expect(question.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await question.getByRole('button', { name: 'Отмена' }).click();
  await expect(annaPage.locator('[data-spelling]')).toHaveCount(0);
  const before = await (await anna.request.get(`/api/groups/${group.id}/tests/${group.deckId}`)).json();
  expect(before.mine.state).toBe('none');
  await startTest(annaPage);
  await expect(annaPage.locator('[data-spelling]').getByText('Тест', { exact: true })).toBeVisible();
  // No hint of either kind, and nothing said between words.
  await expect(annaPage.getByRole('group', { name: 'Подсказки' })).toHaveCount(0);
  await expect(annaPage.getByRole('timer')).toHaveText(/^(10:00|9:\d\d)$/);
  const annaOrder = await answerAll(annaPage);
  await expect(annaPage.getByRole('img', { name: '9 из 9' })).toBeVisible();
  await expect(annaPage.getByRole('heading', { level: 1, name: 'Без единой ошибки!' })).toBeVisible();

  await openDeckTest(ivanPage);
  await startTest(ivanPage);
  const wrong = Object.keys(WORDS)
    .filter((meaningText) => meaningText !== 'галька')
    .slice(0, 5);
  const ivanOrder = await answerAll(ivanPage, wrong);
  await expect(ivanPage.getByRole('img', { name: '4 из 9' })).toBeVisible();
  await expect(ivanPage.getByRole('heading', { level: 1, name: 'Пока не сдан' })).toBeVisible();
  await expect(ivanPage.getByRole('region', { name: 'Ошибки' }).getByRole('listitem')).toHaveCount(5);

  expect(annaOrder).toHaveLength(9);
  expect(new Set(annaOrder).size).toBe(9);
  expect(annaOrder).not.toContain('галька'); // excluded
  expect([...annaOrder].sort()).toEqual([...ivanOrder].sort());
  expect(annaOrder).not.toEqual(ivanOrder); // 1 in 362,880 by chance

  await openDeckTest(page);
  const passed = page.getByRole('region', { name: 'Сдали', exact: true });
  await expect(passed.getByRole('listitem')).toHaveText(['Анна9 из 9']);
  const failed = page.getByRole('region', { name: 'Не сдали' });
  await expect(failed.getByRole('listitem')).toHaveText(['Иван4 из 9']);
  const waiting = page.getByRole('region', { name: 'Ещё не проходили' });
  await expect(waiting.getByRole('listitem')).toHaveText(['Дина']);

  // The group's page says how it went, and once taken the test can't start again.
  await page.getByRole('button', { name: 'Тесты', exact: true }).click();
  await page.getByRole('button', { name: 'К группе', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Тесты/ })).toContainText('Сдали 1 из 3 · Unit 4');
  await annaPage.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(annaPage.getByText('9 из 9 · Сдано')).toBeVisible();
  await expect(annaPage.getByRole('button', { name: /Начать тест/ })).toHaveCount(0);
  await anna.close();
  await ivan.close();
  await dina.close();
});

test('a reload in the middle of a test finds the same word, half-built, and the same clock', async ({
  page,
  context,
}) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });
  await openDeckTest(page);
  await startTest(page);

  const first = (await meaning(page).textContent())!;
  await build(page, WORDS[first]);
  await button(page, 'Дальше').click();
  await expect(page.getByText('1 / 10')).toBeVisible();

  const second = (await meaning(page).textContent())!;
  await build(page, WORDS[second].slice(0, 2));
  await page.reload();

  await expect(meaning(page)).toHaveText(second);
  await expect(page.getByText('1 / 10')).toBeVisible();
  await expect(page.getByRole('group', { name: `Ответ: 2 из ${WORDS[second].length} букв` })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^9:\d\d$/);

  // Leaving warns; the page then offers to go back, still to the same word.
  await page.getByRole('button', { name: 'Выйти из теста' }).click();
  const leave = page.getByRole('dialog', { name: 'Выйти из теста?' });
  await expect(leave.getByText('Время продолжает идти.')).toBeVisible();
  await leave.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: /^Продолжить тест/ }).click();
  await expect(meaning(page)).toHaveText(second);
});

test('when the time is up the tiles lock, the built word counts, and the group sees the result', async ({
  page,
  context,
  browser,
  learner,
}) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: { minutes: 1 } });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await annaPage.clock.install();
  await openDeckTest(annaPage);
  await startTest(annaPage);
  const first = (await meaning(annaPage).textContent())!;
  await build(annaPage, WORDS[first]);
  await button(annaPage, 'Дальше').click();
  await expect(annaPage.getByText('1 / 10')).toBeVisible();
  // The second word is built but not sent when the time runs out.
  const second = (await meaning(annaPage).textContent())!;
  await build(annaPage, WORDS[second]);

  // The server's clock and the device's move together.
  await anna.setExtraHTTPHeaders({
    ...DEMO,
    'X-Dev-User': identities.get(anna)!,
    'X-Dev-Now': new Date(Date.now() + 61_000).toISOString(),
  });
  await annaPage.clock.fastForward(61_000);

  await expect(annaPage.getByRole('img', { name: '2 из 10' })).toBeVisible();
  await expect(annaPage.getByText('Время вышло')).toBeVisible();
  await expect(annaPage.getByRole('heading', { level: 1, name: 'Пока не сдан' })).toBeVisible();
  await expect(annaPage.getByRole('region', { name: 'Не успели' }).getByRole('listitem')).toHaveCount(8);

  await learner.travelTo(new Date(Date.now() + 61_000));
  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Не сдали' }).getByRole('listitem')).toHaveText(['Анна2 из 10']);
  await anna.close();
});

test('someone who starts and never comes back still gets a result', async ({ page, context, browser, learner }) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: { minutes: 1 } });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const started = await anna.request.post(`/api/groups/${group.id}/tests/${group.deckId}/attempts`, {
    data: { kind: 'test' },
  });
  expect(started.ok()).toBe(true);
  await anna.close();

  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Ещё не проходили' }).getByRole('listitem')).toHaveText(['Анна']);

  await learner.travelTo(new Date(Date.now() + 2 * 60_000));
  await page.reload();
  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Не сдали' }).getByRole('listitem')).toHaveText(['Анна0 из 10']);
});

test('practice stays private and shows its mistakes', async ({ page, context, browser }) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await openDeckTest(annaPage);
  // Practice needs only a saved test; the timed one is still closed.
  await button(annaPage, 'Тренировка').click();
  await expect(annaPage.getByRole('timer')).toHaveCount(0);
  await expect(annaPage.locator('[data-spelling]').getByText('Тренировка', { exact: true })).toBeVisible();
  await expect(annaPage.getByRole('button', { name: /Подсказка/ })).toHaveCount(0);
  await answerAll(annaPage, ['неудача']);
  await expect(annaPage.getByRole('img', { name: '2 из 3' })).toBeVisible();
  await expect(annaPage.getByText('Сдано', { exact: true })).toHaveCount(0);
  await expect(annaPage.getByRole('region', { name: 'Ошибки' })).toContainText('setback');

  // Again, in a new attempt.
  await button(annaPage, 'Ещё раз').click();
  await expect(meaning(annaPage)).toBeVisible();
  await answerAll(annaPage, ['неудача']);
  await button(annaPage, 'Готово').click();

  // The group knows nothing of it.
  await openDeckTest(page);
  await button(page, 'Открыть тест').click();
  await expect(page.getByRole('region', { name: 'Ещё не проходили' }).getByRole('listitem')).toHaveText(['Анна']);
  await expect(page.getByRole('region', { name: 'Сдали', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Не сдали' })).toHaveCount(0);
  await anna.close();
});

test('changing the words asks before erasing results, and a student mid-test is told', async ({
  page,
  context,
  browser,
}) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await openDeckTest(annaPage);
  await startTest(annaPage);
  await expect(meaning(annaPage)).toBeVisible();

  await openDeckTest(page);
  await button(page, 'Закрыть тест').click();
  await button(page, 'Настроить тест').click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('radio', { name: 'Случайные' }).check();
  await setup.getByLabel('Сколько случайных слов').fill('4');
  await setup.getByRole('button', { name: 'Сохранить' }).click();

  const confirm = page.getByRole('dialog', { name: 'Другие слова — новый тест' });
  await expect(confirm.getByText('Результаты теста будут удалены: 1.')).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Удалить результаты и сохранить' }).click();
  await expect(page.getByText('4 слова · 10 мин · сдать от 80%')).toBeVisible();

  await build(annaPage, WORDS[(await meaning(annaPage).textContent())!]);
  await button(annaPage, 'Дальше').click();
  await expect(annaPage.getByText('Тест изменился. Начните заново.')).toBeVisible();
  await button(annaPage, 'Назад').click();
  await expect(annaPage.getByText('4 слова · 10 мин · сдать от 80%')).toBeVisible();
  await button(page, 'Открыть тест').click();
  await expect(button(page, 'Закрыть тест')).toBeVisible();
  await openDeckTest(annaPage);
  await expect(button(annaPage, 'Начать тест')).toBeVisible();
  await anna.close();
});

test('a skipped word comes back after the others, half-built as it was, and a second skip is final', async ({
  page,
  context,
}) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });
  await openDeckTest(page);
  await startTest(page);

  const first = (await meaning(page).textContent())!;
  await build(page, WORDS[first].slice(0, 2));
  await button(page, 'Пропустить').click();
  await expect(page.getByText('1 / 3')).toBeVisible();
  await expect(meaning(page)).not.toHaveText(first);

  for (let done = 2; done <= 3; done += 1) {
    await build(page, WORDS[(await meaning(page).textContent())!]);
    await button(page, 'Дальше').click();
    await expect(page.getByText(`${done} / 3`)).toBeVisible();
  }

  // Back, said to be, with what was built so far.
  await expect(meaning(page)).toHaveText(first);
  await expect(page.locator('[data-spelling]').getByText('Пропущенное слово')).toBeVisible();
  await expect(page.getByRole('group', { name: `Ответ: 2 из ${WORDS[first].length} букв` })).toBeVisible();

  await button(page, 'Пропустить').click();
  await expect(page.getByRole('img', { name: '2 из 3' })).toBeVisible();
  // The feedback: what was skipped, with its answer now shown, and no mistakes to compare.
  const skipped = page.getByRole('region', { name: 'Пропущено' });
  await expect(skipped).toContainText(WORDS[first]);
  await expect(skipped).toContainText(first);
  await expect(page.getByRole('region', { name: 'Ошибки' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Не успели' })).toHaveCount(0);
});

test('the owner opens the test again: a student who passed takes it again, and the list follows', async ({
  page,
  context,
  browser,
}) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await annaPage.clock.install();
  await openDeckTest(annaPage);
  await startTest(annaPage);
  await answerAll(annaPage);
  await button(annaPage, 'Готово').click();
  await expect(annaPage.getByText('3 из 3 · Сдано')).toBeVisible();
  await expect(annaPage.getByRole('button', { name: 'Начать тест' })).toHaveCount(0);

  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Сдали', exact: true }).getByRole('listitem')).toHaveText([
    'Анна3 из 3',
  ]);
  await button(page, 'Закрыть тест').click();
  await button(page, 'Открыть тест').click();
  await expect(button(page, 'Закрыть тест')).toBeVisible();
  // The old result stands until there is a new one.
  await expect(page.getByRole('region', { name: 'Сдали', exact: true }).getByRole('listitem')).toHaveText([
    'Анна3 из 3',
  ]);

  // A student already on the page sees it open, without reloading.
  await annaPage.clock.fastForward(31_000);
  await expect(annaPage.getByText('Прошлый раз: 3 из 3 · Сдано')).toBeVisible();
  await startTest(annaPage);
  await answerAll(annaPage, Object.keys(WORDS).slice(0, 3));
  await button(annaPage, 'Готово').click();
  await expect(annaPage.getByText('0 из 3 · Не сдано')).toBeVisible();

  await page.reload();
  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Не сдали' }).getByRole('listitem')).toHaveText(['Анна0 из 3']);
  await expect(page.getByRole('region', { name: 'Сдали', exact: true })).toHaveCount(0);
  await anna.close();
});

test('words misspelled and skipped in a test wait in «Трудные» on the deck page', async ({ context, browser }) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  // A student who has studied no lesson at all.
  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await openDeckTest(annaPage);
  await startTest(annaPage);

  const misspelled = (await meaning(annaPage).textContent())!;
  await build(annaPage, [...WORDS[misspelled]].reverse().join(''));
  await button(annaPage, 'Дальше').click();
  await expect(annaPage.getByText('1 / 3')).toBeVisible();

  const skipped = (await meaning(annaPage).textContent())!;
  await button(annaPage, 'Пропустить').click();
  await expect(annaPage.getByText('2 / 3')).toBeVisible();

  const right = (await meaning(annaPage).textContent())!;
  await build(annaPage, WORDS[right]);
  await button(annaPage, 'Дальше').click();
  await expect(meaning(annaPage)).toHaveText(skipped);
  await button(annaPage, 'Пропустить').click();

  // The feedback, in its groups.
  await expect(annaPage.getByRole('img', { name: '1 из 3' })).toBeVisible();
  await expect(annaPage.getByRole('region', { name: 'Ошибки' })).toContainText(WORDS[misspelled]);
  await expect(annaPage.getByRole('region', { name: 'Пропущено' })).toContainText(WORDS[skipped]);
  await button(annaPage, 'Готово').click();

  // On the deck's page, in individual practice.
  await expect(annaPage.getByRole('heading', { level: 1, name: 'Unit 4' })).toBeVisible();
  // Hard words live in «Трудные», in one place: none on the group's page.
  await expect(annaPage.locator('main')).not.toContainText(WORDS[misspelled]);
  await expect(annaPage.locator('main')).not.toContainText(WORDS[skipped]);
  await annaPage.getByRole('button', { name: 'Сегодня' }).click();
  await annaPage
    .getByRole('button', { name: /Unit 4/ })
    .first()
    .click();
  await expect(button(annaPage, 'Правописание')).toHaveAccessibleDescription(/Трудных слов: 2/);
  await button(annaPage, 'Правописание').click();
  const modes = annaPage.getByRole('dialog', { name: 'Правописание' });
  await modes.getByRole('radio', { name: /Трудные 2.слова с ошибкой/ }).check();
  await modes.getByRole('button', { name: 'Начать · 2 слова' }).click();

  const seen = new Set<string>();
  for (let done = 0; done < 2; done += 1) {
    const shown = (await meaning(annaPage).textContent())!;
    seen.add(shown);
    await build(annaPage, WORDS[shown]);
    await button(annaPage, 'Проверить').click();
    await expect(annaPage.getByRole('status')).toContainText('Верно');
    await button(annaPage, 'Дальше').click();
    if (done === 0) await expect(meaning(annaPage)).not.toHaveText(shown);
  }
  expect([...seen].sort()).toEqual([misspelled, skipped].sort());
  await anna.close();
});

test('a member sees the way to tests only once a test exists', async ({ page, context, browser }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await annaPage.goto('/');
  await annaPage
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await annaPage.getByRole('button', { name: /^7Б/ }).click();
  await expect(annaPage.getByRole('heading', { level: 1, name: '7Б' })).toBeVisible();
  await expect(annaPage.getByRole('button', { name: /^Тесты/ })).toHaveCount(0);

  // The owner gets it as soon as there is a deck, to set one up.
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await expect(page.getByRole('button', { name: /^Тесты/ })).toBeVisible();

  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await openTests(annaPage);
  await expect(annaPage.getByRole('button', { name: /^Unit 4/ })).toBeVisible();
  await anna.close();
});

test('a group with no decks has no way to tests', async ({ page, context }) => {
  await context.request.post('/api/groups', { data: { name: '7Б', nickname: 'Ольга' } });
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '7Б' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Тесты/ })).toHaveCount(0);
});
